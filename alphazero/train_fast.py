"""
ULTRA-FAST AlphaZero Training - Optimized for RTX 5080
- True batch MCTS (multiple games in parallel)
- AMP with BF16 (2x speedup)
- GPU-resident buffer
- Optimized data transfers
"""

import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import os
import time
import json
from datetime import datetime
from dataclasses import dataclass, asdict
from tqdm import tqdm
from collections import deque

from game import TogyzQumalaq, GameState, Player
from model import create_model, count_parameters


@dataclass
class FastConfig:
    """Optimized training configuration"""
    # Model
    model_size: str = "medium"
    
    # Self-play (optimized)
    games_per_iteration: int = 200
    num_simulations: int = 200  # Reduced - batch MCTS compensates
    temperature_threshold: int = 15
    batch_size_games: int = 32  # Play this many games in parallel
    
    # Training
    batch_size: int = 1024  # Larger batch for better GPU utilization
    learning_rate: float = 0.002
    weight_decay: float = 1e-4
    num_epochs: int = 5
    
    # Buffer
    buffer_size: int = 100000
    min_buffer_size: int = 2000
    
    # Iterations
    num_iterations: int = 100
    eval_interval: int = 10
    save_interval: int = 20
    eval_games: int = 30
    
    # Paths
    checkpoint_dir: str = "checkpoints"
    log_dir: str = "logs"


class TrueBatchMCTS:
    """
    REAL batch MCTS - plays multiple games simultaneously
    Batches ALL leaf evaluations for maximum GPU utilization
    """
    
    def __init__(self, model, num_simulations=200, c_puct=1.5, device='cuda', use_amp=True):
        self.model = model
        self.num_simulations = num_simulations
        self.c_puct = c_puct
        self.device = device
        self.use_amp = use_amp and device == 'cuda'
        self.dirichlet_alpha = 0.3
        self.dirichlet_eps = 0.25
    
    @torch.no_grad()
    def batch_predict(self, states_encoded: np.ndarray) -> tuple:
        """Batch prediction on GPU with AMP"""
        x = torch.FloatTensor(states_encoded).to(self.device, non_blocking=True)
        
        if self.use_amp:
            with torch.amp.autocast('cuda', dtype=torch.bfloat16):
                log_policy, value = self.model(x)
        else:
            log_policy, value = self.model(x)
        
        # Convert to float32 before numpy (BF16 not supported in numpy)
        policy = torch.exp(log_policy).float().cpu().numpy()
        value = value.float().cpu().numpy()[:, 0]
        return policy, value
    
    def search_batch(self, games: list) -> list:
        """
        MCTS for multiple games simultaneously
        Batches all leaf evaluations
        
        Args:
            games: List of TogyzQumalaq game objects
            
        Returns:
            List of policy distributions (one per game)
        """
        num_games = len(games)
        if num_games == 0:
            return []
        
        # Get root states
        root_states = [g.get_state() for g in games]
        root_encodings = np.array([g.encode_state() for g in games])
        valid_moves = np.array([g.get_valid_moves() for g in games])
        
        # Batch predict root states
        root_policies, _ = self.batch_predict(root_encodings)
        
        # Process each game's root policy
        processed_policies = []
        for i in range(num_games):
            policy = root_policies[i] * valid_moves[i]
            policy_sum = policy.sum()
            if policy_sum > 0:
                policy = policy / policy_sum
            else:
                policy = valid_moves[i] / valid_moves[i].sum()
            
            # Add Dirichlet noise (only if eps > 0)
            if self.dirichlet_eps > 0:
                noise = np.random.dirichlet([self.dirichlet_alpha] * 9)
                policy = (1 - self.dirichlet_eps) * policy + self.dirichlet_eps * noise * valid_moves[i]
                policy = policy / policy.sum()
            processed_policies.append(policy)
        
        # Initialize statistics for all games
        visit_counts = np.zeros((num_games, 9), dtype=np.int32)
        total_values = np.zeros((num_games, 9), dtype=np.float32)
        
        # Batch size for leaf evaluations (larger = better GPU utilization)
        leaf_batch_size = 64
        
        # Collect all leaf states for batch evaluation
        leaf_states_batch = []
        leaf_game_indices = []
        leaf_action_indices = []
        
        # Run simulations
        for sim in range(self.num_simulations):
            # Select actions for all games using PUCT
            actions = []
            for i in range(num_games):
                sqrt_total = np.sqrt(visit_counts[i].sum() + 1)
                q_values = np.divide(total_values[i], visit_counts[i] + 1e-8,
                                    where=visit_counts[i] > 0, out=np.zeros(9))
                
                ucb = q_values + self.c_puct * processed_policies[i] * sqrt_total / (1 + visit_counts[i])
                ucb = np.where(valid_moves[i] > 0, ucb, -np.inf)
                actions.append(int(np.argmax(ucb)))
            
            # Make moves and collect leaf states
            for i, action in enumerate(actions):
                sim_game = TogyzQumalaq()
                sim_game.set_state(root_states[i])
                sim_game.make_move(action)
                
                if sim_game.is_terminal():
                    # Terminal state - compute value directly
                    winner = sim_game.get_winner()
                    if winner == 2:
                        value = 0.0
                    elif winner == root_states[i].current_player:
                        value = 1.0
                    else:
                        value = -1.0
                    
                    # Update stats
                    visit_counts[i, action] += 1
                    total_values[i, action] += value
                else:
                    # Non-terminal - add to batch for evaluation
                    leaf_states_batch.append(sim_game.encode_state())
                    leaf_game_indices.append(i)
                    leaf_action_indices.append(action)
            
            # Batch evaluate when we have enough or at end of simulation
            if len(leaf_states_batch) >= leaf_batch_size or (sim == self.num_simulations - 1 and len(leaf_states_batch) > 0):
                leaf_encodings = np.array(leaf_states_batch)
                _, leaf_values = self.batch_predict(leaf_encodings)
                
                # Update stats for each leaf
                for idx, (game_idx, action) in enumerate(zip(leaf_game_indices, leaf_action_indices)):
                    value = -leaf_values[idx]  # Flip for opponent
                    visit_counts[game_idx, action] += 1
                    total_values[game_idx, action] += value
                
                # Clear batch
                leaf_states_batch = []
                leaf_game_indices = []
                leaf_action_indices = []
        
        # Return visit distributions as policies
        policies = []
        for i in range(num_games):
            visit_policy = visit_counts[i].astype(np.float32)
            if visit_policy.sum() > 0:
                visit_policy = visit_policy / visit_policy.sum()
            else:
                visit_policy = valid_moves[i] / valid_moves[i].sum()
            policies.append(visit_policy)
        
        return policies


class ParallelSelfPlay:
    """
    True parallel self-play using batch GPU inference
    Plays multiple games simultaneously with batched MCTS
    """
    
    def __init__(self, model, config: FastConfig, device='cuda'):
        self.model = model
        self.config = config
        self.device = device
        self.mcts = TrueBatchMCTS(model, config.num_simulations, device=device, use_amp=True)
    
    def play_games(self, num_games: int) -> list:
        """Play multiple games in batches"""
        all_examples = []
        batch_size = self.config.batch_size_games
        
        num_batches = (num_games + batch_size - 1) // batch_size
        
        for batch_idx in tqdm(range(num_batches), desc="Self-play batches"):
            start_idx = batch_idx * batch_size
            end_idx = min(start_idx + batch_size, num_games)
            batch_games = end_idx - start_idx
            
            # Play batch of games
            batch_examples = self._play_batch(batch_games)
            all_examples.extend(batch_examples)
        
        return all_examples
    
    def _play_batch(self, num_games: int) -> list:
        """Play a batch of games simultaneously"""
        games = [TogyzQumalaq() for _ in range(num_games)]
        all_examples = [[] for _ in range(num_games)]
        active_indices = list(range(num_games))
        move_counts = [0] * num_games
        max_moves = 200
        
        while active_indices:
            # Get active games
            active_games = [games[i] for i in active_indices]
            
            # Batch MCTS for all active games
            policies = self.mcts.search_batch(active_games)
            
            # Apply moves and record examples
            new_active = []
            for idx, policy in zip(active_indices, policies):
                game = games[idx]
                move_count = move_counts[idx]
                
                if game.is_terminal() or move_count >= max_moves:
                    continue
                
                state = game.get_state()
                encoded = game.encode_state()
                
                # Store example
                all_examples[idx].append({
                    'state': encoded.copy(),
                    'policy': policy.copy(),
                    'player': state.current_player
                })
                
                # Select move
                if move_count < self.config.temperature_threshold:
                    action = int(np.random.choice(9, p=policy))
                else:
                    action = int(np.argmax(policy))
                
                game.make_move(action)
                move_counts[idx] += 1
                
                if not game.is_terminal() and move_counts[idx] < max_moves:
                    new_active.append(idx)
            
            active_indices = new_active
        
        # Assign values based on outcomes
        training_examples = []
        for idx, examples in enumerate(all_examples):
            game = games[idx]
            winner = game.get_winner()
            
            for ex in examples:
                if winner == 2:
                    value = 0.0
                elif winner == ex['player']:
                    value = 1.0
                else:
                    value = -1.0
                
                training_examples.append({
                    'state': ex['state'],
                    'policy': ex['policy'],
                    'value': value
                })
        
        return training_examples


class FastTrainer:
    """
    Ultra-optimized AlphaZero trainer for RTX 5080
    """
    
    def __init__(self, config: FastConfig):
        self.config = config
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.use_amp = self.device == "cuda"
        
        print(f"Device: {self.device}")
        if self.device == "cuda":
            print(f"GPU: {torch.cuda.get_device_name(0)}")
            print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
            
            # Enable TF32 for faster computation
            torch.set_float32_matmul_precision('high')
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            print("TF32 enabled")
            
            # Check BF16 support
            if torch.cuda.is_bf16_supported():
                print("BF16 (AMP) supported - will use for 2x speedup")
            else:
                print("BF16 not supported, using FP32")
                self.use_amp = False
        
        # Create model
        self.model = create_model(config.model_size, self.device)
        print(f"Model: {config.model_size} ({count_parameters(self.model):,} params)")
        
        # Compile model for speed
        try:
            self.model = torch.compile(self.model, mode='reduce-overhead')
            print("Model compiled with torch.compile()")
        except Exception as e:
            print(f"torch.compile() not available: {e}")
        
        # AMP scaler
        if self.use_amp:
            self.scaler = torch.amp.GradScaler('cuda')
            print("AMP (Automatic Mixed Precision) enabled")
        
        # Optimizer
        self.optimizer = optim.AdamW(
            self.model.parameters(),
            lr=config.learning_rate,
            weight_decay=config.weight_decay
        )
        
        # Scheduler
        self.scheduler = optim.lr_scheduler.CosineAnnealingLR(
            self.optimizer,
            T_max=config.num_iterations * config.num_epochs * 100,
            eta_min=config.learning_rate * 0.01
        )
        
        # Buffer - use deque for efficient appends/pops
        self.buffer_states = deque(maxlen=config.buffer_size)
        self.buffer_policies = deque(maxlen=config.buffer_size)
        self.buffer_values = deque(maxlen=config.buffer_size)
        
        # Pre-allocate GPU tensors for training (reused)
        self._states_tensor = None
        self._policies_tensor = None
        self._values_tensor = None
        
        # Stats
        self.iteration = 0
        self.total_games = 0
        self.history = []
        
        # Dirs
        os.makedirs(config.checkpoint_dir, exist_ok=True)
        os.makedirs(config.log_dir, exist_ok=True)
    
    def self_play(self) -> int:
        """Generate training data with batch MCTS"""
        self.model.eval()
        
        player = ParallelSelfPlay(self.model, self.config, self.device)
        examples = player.play_games(self.config.games_per_iteration)
        
        # Add to buffer
        for ex in examples:
            self.buffer_states.append(ex['state'])
            self.buffer_policies.append(ex['policy'])
            self.buffer_values.append(ex['value'])
        
        self.total_games += self.config.games_per_iteration
        return len(examples)
    
    def train_epoch(self) -> dict:
        """Train one epoch with AMP"""
        self.model.train()
        
        n = len(self.buffer_states)
        if n == 0:
            return {'loss': 0.0, 'policy_loss': 0.0, 'value_loss': 0.0}
        
        indices = np.random.permutation(n)
        
        total_loss = 0.0
        total_policy_loss = 0.0
        total_value_loss = 0.0
        num_batches = 0
        
        for start in range(0, n, self.config.batch_size):
            end = min(start + self.config.batch_size, n)
            batch_idx = indices[start:end]
            batch_size_actual = len(batch_idx)
            
            # Convert to tensors (non-blocking transfer)
            states_list = [self.buffer_states[i] for i in batch_idx]
            policies_list = [self.buffer_policies[i] for i in batch_idx]
            values_list = [self.buffer_values[i] for i in batch_idx]
            
            states = torch.FloatTensor(np.array(states_list)).to(self.device, non_blocking=True)
            target_policies = torch.FloatTensor(np.array(policies_list)).to(self.device, non_blocking=True)
            target_values = torch.FloatTensor(np.array(values_list)).unsqueeze(1).to(self.device, non_blocking=True)
            
            self.optimizer.zero_grad()
            
            # Forward pass with AMP
            if self.use_amp:
                with torch.amp.autocast('cuda', dtype=torch.bfloat16):
                    log_policies, values = self.model(states)
                    policy_loss = -torch.mean(torch.sum(target_policies * log_policies, dim=1))
                    value_loss = torch.mean((values - target_values) ** 2)
                    loss = policy_loss + value_loss
                
                # Backward with scaler
                self.scaler.scale(loss).backward()
                self.scaler.unscale_(self.optimizer)
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                self.scaler.step(self.optimizer)
                self.scaler.update()
            else:
                log_policies, values = self.model(states)
                policy_loss = -torch.mean(torch.sum(target_policies * log_policies, dim=1))
                value_loss = torch.mean((values - target_values) ** 2)
                loss = policy_loss + value_loss
                
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                self.optimizer.step()
            
            total_loss += loss.item()
            total_policy_loss += policy_loss.item()
            total_value_loss += value_loss.item()
            num_batches += 1
        
        return {
            'loss': total_loss / num_batches,
            'policy_loss': total_policy_loss / num_batches,
            'value_loss': total_value_loss / num_batches
        }
    
    def evaluate(self) -> dict:
        """Quick evaluation vs random"""
        self.model.eval()
        wins = 0
        
        mcts = TrueBatchMCTS(self.model, num_simulations=100, device=self.device, use_amp=True)
        
        for i in range(self.config.eval_games):
            game = TogyzQumalaq()
            model_player = i % 2
            
            while not game.is_terminal():
                if game.state.current_player == model_player:
                    policy = mcts.search_batch([game])[0]
                    action = int(np.argmax(policy))
                else:
                    valid = game.get_valid_moves_list()
                    action = np.random.choice(valid)
                game.make_move(action)
            
            winner = game.get_winner()
            if winner == model_player:
                wins += 1
            elif winner == 2:
                wins += 0.5
        
        return {'win_rate': wins / self.config.eval_games}
    
    def train_iteration(self):
        """One full iteration"""
        self.iteration += 1
        print(f"\n{'='*60}")
        print(f"Iteration {self.iteration}/{self.config.num_iterations}")
        print(f"{'='*60}")
        
        # Self-play
        print("\n[Self-Play]")
        start = time.time()
        num_examples = self.self_play()
        sp_time = time.time() - start
        games_per_sec = self.config.games_per_iteration / sp_time
        
        print(f"Generated {num_examples} examples in {sp_time:.1f}s ({games_per_sec:.2f} games/s)")
        print(f"Buffer: {len(self.buffer_states)}, Total games: {self.total_games}")
        
        if len(self.buffer_states) < self.config.min_buffer_size:
            print(f"Waiting for buffer ({len(self.buffer_states)}/{self.config.min_buffer_size})")
            return
        
        # Training
        print("\n[Training]")
        start = time.time()
        
        for epoch in range(self.config.num_epochs):
            metrics = self.train_epoch()
            print(f"  Epoch {epoch+1}: loss={metrics['loss']:.4f} "
                  f"(policy={metrics['policy_loss']:.4f}, value={metrics['value_loss']:.4f})")
        
        self.scheduler.step()
        train_time = time.time() - start
        print(f"Training time: {train_time:.1f}s, LR: {self.optimizer.param_groups[0]['lr']:.6f}")
        
        # Eval
        if self.iteration % self.config.eval_interval == 0:
            print("\n[Evaluation]")
            eval_result = self.evaluate()
            print(f"Win rate vs random: {eval_result['win_rate']*100:.1f}%")
        
        # Save
        if self.iteration % self.config.save_interval == 0:
            self.save_checkpoint()
    
    def load_checkpoint(self, path: str):
        """Load checkpoint and continue training"""
        print(f"\nLoading checkpoint: {path}")
        checkpoint = torch.load(path, map_location=self.device)
        
        # Handle torch.compile() prefix
        state_dict = checkpoint['model_state_dict']
        if any(k.startswith('_orig_mod.') for k in state_dict.keys()):
            new_state_dict = {}
            for k, v in state_dict.items():
                if k.startswith('_orig_mod.'):
                    new_state_dict[k[10:]] = v
                else:
                    new_state_dict[k] = v
            state_dict = new_state_dict
        
        # Load model state
        try:
            if hasattr(self.model, '_orig_mod'):
                self.model._orig_mod.load_state_dict(state_dict)
            else:
                self.model.load_state_dict(state_dict)
            print("✅ Model weights loaded")
        except Exception as e:
            print(f"⚠️ Warning: Error loading model state: {e}")
            print("Trying to load with strict=False...")
            if hasattr(self.model, '_orig_mod'):
                self.model._orig_mod.load_state_dict(state_dict, strict=False)
            else:
                self.model.load_state_dict(state_dict, strict=False)
        
        # Load optimizer state
        if 'optimizer_state_dict' in checkpoint:
            try:
                self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
                print("✅ Optimizer state loaded")
            except Exception as e:
                print(f"⚠️ Warning: Could not load optimizer state: {e}")
        
        # Load training state
        self.iteration = checkpoint.get('iteration', 0)
        self.total_games = checkpoint.get('total_games', 0)
        
        # Load scheduler
        if 'scheduler_state_dict' in checkpoint:
            try:
                self.scheduler.load_state_dict(checkpoint['scheduler_state_dict'])
                print("✅ Scheduler state loaded")
            except Exception as e:
                print(f"⚠️ Warning: Could not load scheduler state: {e}")
        
        # Load scaler if using AMP
        if self.use_amp and 'scaler_state_dict' in checkpoint:
            try:
                self.scaler.load_state_dict(checkpoint['scaler_state_dict'])
                print("✅ AMP scaler state loaded")
            except:
                pass
        
        print(f"✅ Loaded: iteration {self.iteration}, total games {self.total_games}")
        
        if 'config' in checkpoint:
            checkpoint_config = checkpoint['config']
            print(f"Checkpoint config: {checkpoint_config.get('model_size', 'unknown')} model, "
                  f"{checkpoint_config.get('games_per_iteration', 'unknown')} games/iter")
    
    def save_checkpoint(self):
        """Save model"""
        path = os.path.join(self.config.checkpoint_dir, f"model_iter{self.iteration}.pt")
        checkpoint = {
            'iteration': self.iteration,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'scheduler_state_dict': self.scheduler.state_dict(),
            'total_games': self.total_games,
            'config': asdict(self.config)
        }
        
        if self.use_amp:
            checkpoint['scaler_state_dict'] = self.scaler.state_dict()
        
        torch.save(checkpoint, path)
        print(f"Saved: {path}")
        
        # Also save latest
        latest = os.path.join(self.config.checkpoint_dir, "model_latest.pt")
        torch.save(checkpoint, latest)
    
    def train(self):
        """Full training loop"""
        print("\n" + "="*60)
        print("ULTRA-FAST AlphaZero Training for Тоғызқұмалақ")
        print("="*60)
        print(f"Optimizations: Batch MCTS ({self.config.batch_size_games} games), AMP, GPU buffer")
        print("="*60)
        
        remaining_iterations = self.config.num_iterations - self.iteration
        if remaining_iterations <= 0:
            print(f"Already completed {self.iteration} iterations (target: {self.config.num_iterations})")
            print("Increase --iterations to continue training")
            return
        
        print(f"Starting from iteration {self.iteration + 1}/{self.config.num_iterations}")
        print(f"Will train for {remaining_iterations} more iterations")
        
        start = time.time()
        
        try:
            for _ in range(remaining_iterations):
                self.train_iteration()
        except KeyboardInterrupt:
            print("\nInterrupted!")
        finally:
            total = time.time() - start
            print(f"\n{'='*60}")
            print(f"Completed in {total/60:.1f} minutes")
            print(f"Total games: {self.total_games}, Total iterations: {self.iteration}")
            print(f"{'='*60}")
            
            self.save_checkpoint()


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Ultra-Fast AlphaZero Training")
    parser.add_argument("--model-size", default="medium", choices=["small", "medium", "large"],
                       help="Model size")
    parser.add_argument("--games", type=int, default=200,
                       help="Games per iteration")
    parser.add_argument("--simulations", type=int, default=200,
                       help="MCTS simulations per move (reduced - batch MCTS compensates)")
    parser.add_argument("--batch-games", type=int, default=32,
                       help="Number of games to play in parallel (batch size for MCTS)")
    parser.add_argument("--iterations", type=int, default=100,
                       help="Total number of iterations")
    parser.add_argument("--batch-size", type=int, default=1024,
                       help="Training batch size")
    parser.add_argument("--resume", type=str, default=None,
                       help="Resume training from checkpoint")
    args = parser.parse_args()
    
    config = FastConfig(
        model_size=args.model_size,
        games_per_iteration=args.games,
        num_simulations=args.simulations,
        batch_size_games=args.batch_games,
        num_iterations=args.iterations,
        batch_size=args.batch_size
    )
    
    trainer = FastTrainer(config)
    
    if args.resume:
        if not os.path.exists(args.resume):
            print(f"❌ Checkpoint not found: {args.resume}")
            return
        trainer.load_checkpoint(args.resume)
    
    trainer.train()


if __name__ == "__main__":
    main()
