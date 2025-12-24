/**
 * Тоғызқұмалақ - Traditional Kazakh board game
 * Game logic and AI
 */

// ==================== GAME STATE (for AI simulation) ====================
class GameState {
    constructor() {
        this.pits = {
            white: [9, 9, 9, 9, 9, 9, 9, 9, 9],
            black: [9, 9, 9, 9, 9, 9, 9, 9, 9]
        };
        this.kazan = { white: 0, black: 0 };
        this.tuzdyk = { white: -1, black: -1 };
        this.currentPlayer = 'white';
    }
    
    clone() {
        const state = new GameState();
        state.pits = {
            white: [...this.pits.white],
            black: [...this.pits.black]
        };
        state.kazan = { ...this.kazan };
        state.tuzdyk = { ...this.tuzdyk };
        state.currentPlayer = this.currentPlayer;
        return state;
    }
    
    getOpponent(player) {
        return player === 'white' ? 'black' : 'white';
    }
    
    getValidMoves(player) {
        const moves = [];
        for (let i = 0; i < 9; i++) {
            if (this.pits[player][i] > 0) moves.push(i);
        }
        return moves;
    }
    
    canCreateTuzdyk(player, pitIndex) {
        if (this.tuzdyk[player] !== -1) return false;
        if (pitIndex === 8) return false;
        const opponent = this.getOpponent(player);
        if (this.tuzdyk[opponent] === pitIndex) return false;
        return true;
    }
    
    // Fast move simulation without animation
    makeMove(pitIndex) {
        const player = this.currentPlayer;
        const opponent = this.getOpponent(player);
        
        let stones = this.pits[player][pitIndex];
        if (stones === 0) return false;
        
        this.pits[player][pitIndex] = 0;
        
        let currentPit = pitIndex;
        let currentSide = player;
        
        // Special case: 1 stone moves to next pit
        if (stones === 1) {
            currentPit++;
            if (currentPit > 8) {
                currentPit = 0;
                currentSide = opponent;
            }
            
            // Check if landing on own tuzdyk
            if (currentSide === opponent && this.tuzdyk[player] === currentPit) {
                this.kazan[player]++;
            } else {
                this.pits[currentSide][currentPit]++;
            }
        } else {
            // First stone in same pit
            this.pits[currentSide][currentPit]++;
            stones--;
            
            // Distribute remaining
            while (stones > 0) {
                currentPit++;
                if (currentPit > 8) {
                    currentPit = 0;
                    currentSide = currentSide === 'white' ? 'black' : 'white';
                }
                
                // Tuzdyk capture during distribution
                if (currentSide !== player && this.tuzdyk[player] === currentPit) {
                    this.kazan[player]++;
                } else {
                    this.pits[currentSide][currentPit]++;
                }
                stones--;
            }
        }
        
        // Check captures
        if (currentSide === opponent && this.tuzdyk[opponent] !== currentPit) {
            const count = this.pits[opponent][currentPit];
            
            // Tuzdyk creation
            if (count === 3 && this.canCreateTuzdyk(player, currentPit)) {
                this.tuzdyk[player] = currentPit;
                this.kazan[player] += count;
                this.pits[opponent][currentPit] = 0;
            }
            // Even capture
            else if (count % 2 === 0 && count > 0) {
                this.kazan[player] += count;
                this.pits[opponent][currentPit] = 0;
            }
        }
        
        this.currentPlayer = opponent;
        return true;
    }
    
    isGameOver() {
        if (this.kazan.white >= 82 || this.kazan.black >= 82) return true;
        const whiteEmpty = this.pits.white.every(p => p === 0);
        const blackEmpty = this.pits.black.every(p => p === 0);
        return whiteEmpty || blackEmpty;
    }
    
    getWinner() {
        if (this.kazan.white >= 82) return 'white';
        if (this.kazan.black >= 82) return 'black';
        if (this.kazan.white > this.kazan.black) return 'white';
        if (this.kazan.black > this.kazan.white) return 'black';
        return 'draw';
    }
}

// ==================== AI ENGINE ====================
class TogyzAI {
    constructor(difficulty = 'hard') {
        this.difficulty = difficulty;
        this.maxDepth = difficulty === 'hard' ? 6 : (difficulty === 'medium' ? 4 : 2);
        this.nodesEvaluated = 0;
    }
    
    // Minimax with Alpha-Beta pruning
    minimax(state, depth, alpha, beta, maximizingPlayer, aiPlayer) {
        this.nodesEvaluated++;
        
        if (depth === 0 || state.isGameOver()) {
            return { score: this.evaluate(state, aiPlayer), move: null };
        }
        
        const currentPlayer = state.currentPlayer;
        const moves = state.getValidMoves(currentPlayer);
        
        if (moves.length === 0) {
            return { score: this.evaluate(state, aiPlayer), move: null };
        }
        
        // Move ordering - prioritize captures and tuzdyk
        const orderedMoves = this.orderMoves(state, moves, currentPlayer);
        
        let bestMove = orderedMoves[0];
        
        if (maximizingPlayer) {
            let maxScore = -Infinity;
            
            for (const move of orderedMoves) {
                const newState = state.clone();
                newState.makeMove(move);
                
                const result = this.minimax(newState, depth - 1, alpha, beta, false, aiPlayer);
                
                if (result.score > maxScore) {
                    maxScore = result.score;
                    bestMove = move;
                }
                
                alpha = Math.max(alpha, result.score);
                if (beta <= alpha) break; // Alpha-Beta cutoff
            }
            
            return { score: maxScore, move: bestMove };
        } else {
            let minScore = Infinity;
            
            for (const move of orderedMoves) {
                const newState = state.clone();
                newState.makeMove(move);
                
                const result = this.minimax(newState, depth - 1, alpha, beta, true, aiPlayer);
                
                if (result.score < minScore) {
                    minScore = result.score;
                    bestMove = move;
                }
                
                beta = Math.min(beta, result.score);
                if (beta <= alpha) break;
            }
            
            return { score: minScore, move: bestMove };
        }
    }
    
    // Move ordering for better pruning
    orderMoves(state, moves, player) {
        const opponent = state.getOpponent(player);
        const scored = moves.map(move => {
            let priority = 0;
            const stones = state.pits[player][move];
            
            // Simulate to find landing position
            let pos = move;
            let side = player;
            let remaining = stones;
            
            if (stones === 1) {
                pos++;
                if (pos > 8) { pos = 0; side = opponent; }
            } else {
                remaining--;
                while (remaining > 0) {
                    pos++;
                    if (pos > 8) { pos = 0; side = side === 'white' ? 'black' : 'white'; }
                    if (side !== player && state.tuzdyk[player] === pos) {
                        priority += 2;
                    }
                    remaining--;
                }
            }
            
            // Check capture potential
            if (side === opponent) {
                const targetStones = state.pits[opponent][pos] + 1;
                if (targetStones === 3 && state.canCreateTuzdyk(player, pos)) {
                    priority += 50; // Tuzdyk is very valuable
                } else if (targetStones % 2 === 0) {
                    priority += targetStones * 2;
                }
            }
            
            return { move, priority };
        });
        
        scored.sort((a, b) => b.priority - a.priority);
        return scored.map(s => s.move);
    }
    
    // Position evaluation
    evaluate(state, aiPlayer) {
        const opponent = state.getOpponent(aiPlayer);
        let score = 0;
        
        // 1. Kazan difference (most important)
        score += (state.kazan[aiPlayer] - state.kazan[opponent]) * 10;
        
        // 2. Win/Loss check
        if (state.kazan[aiPlayer] >= 82) return 10000;
        if (state.kazan[opponent] >= 82) return -10000;
        
        // 3. Tuzdyk value (very important!)
        if (state.tuzdyk[aiPlayer] !== -1) {
            // Value based on position - center tuzdyks are better
            const tuzdykPos = state.tuzdyk[aiPlayer];
            const tuzdykValue = 25 + (4 - Math.abs(4 - tuzdykPos)) * 3;
            score += tuzdykValue;
        }
        if (state.tuzdyk[opponent] !== -1) {
            const tuzdykPos = state.tuzdyk[opponent];
            const tuzdykValue = 25 + (4 - Math.abs(4 - tuzdykPos)) * 3;
            score -= tuzdykValue;
        }
        
        // 4. Potential tuzdyk (if can create one)
        if (state.tuzdyk[aiPlayer] === -1) {
            for (let i = 0; i < 8; i++) {
                if (state.pits[opponent][i] === 2 && state.canCreateTuzdyk(aiPlayer, i)) {
                    score += 8; // Close to creating tuzdyk
                }
            }
        }
        
        // 5. Stone distribution and control
        for (let i = 0; i < 9; i++) {
            const myStones = state.pits[aiPlayer][i];
            const oppStones = state.pits[opponent][i];
            
            // Center pits (4,5,6 - indices 3,4,5) are slightly more valuable
            const centerBonus = (i >= 3 && i <= 5) ? 1.2 : 1.0;
            
            score += myStones * 0.3 * centerBonus;
            score -= oppStones * 0.3 * centerBonus;
            
            // Potential captures
            if (oppStones > 0 && oppStones % 2 === 1) {
                // Odd stones - one more makes even (capturable)
                score += 0.5;
            }
        }
        
        // 6. Mobility (having moves is good)
        const myMoves = state.getValidMoves(aiPlayer).length;
        const oppMoves = state.getValidMoves(opponent).length;
        score += (myMoves - oppMoves) * 1.5;
        
        // 7. Endgame considerations
        const totalOnBoard = state.pits.white.reduce((a, b) => a + b, 0) + 
                            state.pits.black.reduce((a, b) => a + b, 0);
        
        if (totalOnBoard < 50) {
            // In endgame, kazan lead is more important
            score += (state.kazan[aiPlayer] - state.kazan[opponent]) * 5;
        }
        
        return score;
    }
    
    getBestMove(state, player) {
        this.nodesEvaluated = 0;
        const isMaximizing = state.currentPlayer === player;
        
        const result = this.minimax(
            state.clone(),
            this.maxDepth,
            -Infinity,
            Infinity,
            isMaximizing,
            player
        );
        
        console.log(`AI evaluated ${this.nodesEvaluated} nodes, best move: ${result.move + 1}, score: ${result.score.toFixed(1)}`);
        return result.move;
    }
}

// ==================== MAIN GAME CLASS ====================
class TogyzQumalaq {
    constructor() {
        this.state = new GameState();
        this.gameOver = false;
        this.isAnimating = false;
        this.gameMode = 'pvp';
        this.lastMove = null;
        this.animationDelay = 60;
        
        // AI
        this.ai = new TogyzAI('hard');
        
        this.initUI();
        this.renderBoard();
    }
    
    // Getters for compatibility
    get pits() { return this.state.pits; }
    get kazan() { return this.state.kazan; }
    get tuzdyk() { return this.state.tuzdyk; }
    get currentPlayer() { return this.state.currentPlayer; }
    set currentPlayer(val) { this.state.currentPlayer = val; }
    
    initUI() {
        document.querySelectorAll('.pit').forEach(pit => {
            pit.addEventListener('click', () => this.handlePitClick(pit));
        });
        
        document.getElementById('newGameBtn').addEventListener('click', () => this.newGame());
        document.getElementById('modeToggleBtn').addEventListener('click', () => this.toggleMode());
        document.getElementById('playAgainBtn').addEventListener('click', () => {
            document.getElementById('winModal').classList.remove('show');
            this.newGame();
        });
    }
    
    handlePitClick(pitElement) {
        if (this.gameOver || this.isAnimating) return;
        
        const player = pitElement.dataset.player;
        const pitIndex = parseInt(pitElement.dataset.pit);
        
        if (player !== this.currentPlayer) return;
        if (this.pits[player][pitIndex] === 0) return;
        
        this.makeMove(pitIndex);
    }
    
    async makeMove(pitIndex) {
        const player = this.currentPlayer;
        const opponent = player === 'white' ? 'black' : 'white';
        
        let stones = this.pits[player][pitIndex];
        if (stones === 0) return;
        
        this.isAnimating = true;
        this.lastMove = { player, pit: pitIndex + 1, stones };
        
        // Animation logic
        if (stones === 1) {
            this.pits[player][pitIndex] = 0;
            
            let nextPit = pitIndex + 1;
            let nextSide = player;
            
            if (nextPit > 8) {
                nextPit = 0;
                nextSide = opponent;
            }
            
            await this.delay(this.animationDelay);
            
            if (nextSide === opponent && this.tuzdyk[player] === nextPit) {
                this.kazan[player]++;
                this.renderKazan(player, true);
            } else {
                this.pits[nextSide][nextPit]++;
                this.renderBoard();
            }
            
            // Check capture
            if (nextSide === opponent && this.tuzdyk[player] !== nextPit) {
                const count = this.pits[opponent][nextPit];
                
                if (count === 3 && this.state.canCreateTuzdyk(player, nextPit)) {
                    await this.delay(200);
                    this.tuzdyk[player] = nextPit;
                    await this.captureToKazan(player, opponent, nextPit);
                } else if (count % 2 === 0 && count > 0) {
                    await this.delay(200);
                    await this.captureToKazan(player, opponent, nextPit);
                }
            }
        } else {
            this.pits[player][pitIndex] = 0;
            this.renderBoard();
            
            let currentPit = pitIndex;
            let currentSide = player;
            
            await this.delay(this.animationDelay);
            this.pits[currentSide][currentPit]++;
            this.renderPit(currentSide, currentPit, true);
            stones--;
            
            while (stones > 0) {
                currentPit++;
                if (currentPit > 8) {
                    currentPit = 0;
                    currentSide = currentSide === 'white' ? 'black' : 'white';
                }
                
                if (currentSide !== player && this.tuzdyk[player] === currentPit) {
                    await this.delay(this.animationDelay);
                    this.kazan[player]++;
                    this.renderKazan(player, true);
                    stones--;
                    continue;
                }
                
                await this.delay(this.animationDelay);
                this.pits[currentSide][currentPit]++;
                this.renderPit(currentSide, currentPit, true);
                stones--;
            }
            
            const lastPit = currentPit;
            const lastSide = currentSide;
            
            if (lastSide === opponent && this.tuzdyk[opponent] !== lastPit) {
                const count = this.pits[opponent][lastPit];
                
                if (count === 3 && this.state.canCreateTuzdyk(player, lastPit)) {
                    await this.delay(200);
                    this.tuzdyk[player] = lastPit;
                    await this.captureToKazan(player, opponent, lastPit);
                } else if (count % 2 === 0 && count > 0) {
                    await this.delay(200);
                    await this.captureToKazan(player, opponent, lastPit);
                }
            }
        }
        
        this.updateLastMove();
        this.isAnimating = false;
        
        if (this.checkWin()) {
            this.endGame();
            return;
        }
        
        this.state.currentPlayer = opponent;
        this.updateTurnIndicator();
        this.updateClickablePits();
        
        // AI move
        if (this.gameMode === 'bot' && this.currentPlayer === 'black' && !this.gameOver) {
            await this.delay(300);
            this.makeBotMove();
        }
    }
    
    async captureToKazan(player, opponent, pitIndex) {
        const stones = this.pits[opponent][pitIndex];
        if (stones === 0) return;
        
        const pitEl = document.querySelector(`.pit[data-player="${opponent}"][data-pit="${pitIndex}"]`);
        pitEl.querySelectorAll('.stone').forEach(stone => {
            stone.classList.add('captured');
        });
        
        await this.delay(400);
        
        this.pits[opponent][pitIndex] = 0;
        this.kazan[player] += stones;
        
        this.renderPit(opponent, pitIndex);
        this.renderKazan(player, true);
    }
    
    checkWin() {
        if (this.kazan.white >= 82) return 'white';
        if (this.kazan.black >= 82) return 'black';
        
        const whiteEmpty = this.pits.white.every(p => p === 0);
        const blackEmpty = this.pits.black.every(p => p === 0);
        
        if (whiteEmpty || blackEmpty) {
            if (this.kazan.white > this.kazan.black) return 'white';
            if (this.kazan.black > this.kazan.white) return 'black';
            return 'draw';
        }
        
        return null;
    }
    
    endGame() {
        this.gameOver = true;
        const winner = this.checkWin();
        
        const winnerText = document.getElementById('winnerText');
        const finalScore = document.getElementById('finalScore');
        
        if (winner === 'draw') {
            winnerText.textContent = 'Тең ойын!';
        } else {
            const winnerName = winner === 'white' ? 'Ақ' : 'Қара';
            winnerText.textContent = `${winnerName} жеңді!`;
        }
        
        finalScore.textContent = `Есеп: Ақ ${this.kazan.white} - ${this.kazan.black} Қара`;
        
        const modal = document.getElementById('winModal');
        modal.style.display = 'flex';
        modal.classList.add('show');
    }
    
    // AI Move
    async makeBotMove() {
        if (this.gameOver || this.isAnimating) return;
        
        const validMoves = this.state.getValidMoves('black');
        if (validMoves.length === 0) return;
        
        // Use AI to get best move
        const bestMove = this.ai.getBestMove(this.state, 'black');
        
        if (bestMove !== null) {
            await this.makeMove(bestMove);
        }
    }
    
    // UI Methods
    renderBoard() {
        for (let i = 0; i < 9; i++) {
            this.renderPit('white', i);
            this.renderPit('black', i);
        }
        this.renderKazan('white');
        this.renderKazan('black');
        this.updateTurnIndicator();
        this.updateClickablePits();
        this.updateScores();
        this.updateTuzdykIndicators();
    }
    
    renderPit(player, pitIndex, animate = false) {
        const pit = document.querySelector(`.pit[data-player="${player}"][data-pit="${pitIndex}"]`);
        const container = pit.querySelector('.stones-container');
        const countEl = pit.querySelector('.stone-count');
        const stoneCount = this.pits[player][pitIndex];
        
        container.innerHTML = '';
        
        const stonesPerLayer = 10;
        const numLayers = Math.ceil(stoneCount / stonesPerLayer) || 1;
        
        let stonesRemaining = stoneCount;
        
        for (let layer = 0; layer < numLayers && layer < 3; layer++) {
            const layerDiv = document.createElement('div');
            layerDiv.className = 'stones-layer' + (layer > 0 ? ` layer-${layer + 1}` : '');
            
            const stonesInThisLayer = Math.min(stonesRemaining, stonesPerLayer);
            
            for (let i = 0; i < stonesInThisLayer; i++) {
                const stone = document.createElement('div');
                stone.className = 'stone' + (animate ? ' animated' : '');
                layerDiv.appendChild(stone);
            }
            
            container.appendChild(layerDiv);
            stonesRemaining -= stonesInThisLayer;
        }
        
        countEl.textContent = stoneCount;
        
        const opponent = player === 'white' ? 'black' : 'white';
        if (this.tuzdyk[opponent] === pitIndex) {
            pit.classList.add('tuzdyk');
        } else {
            pit.classList.remove('tuzdyk');
        }
        
        if (animate) {
            pit.classList.add('last-move');
            setTimeout(() => pit.classList.remove('last-move'), 600);
        }
    }
    
    renderKazan(player, animate = false) {
        const kazan = document.getElementById(`kazan${player.charAt(0).toUpperCase() + player.slice(1)}`);
        const stonesContainer = kazan.querySelector('.kazan-stones');
        const countEl = kazan.querySelector('.kazan-count');
        const stoneCount = this.kazan[player];
        
        stonesContainer.innerHTML = '';
        const visualStones = Math.min(stoneCount, 40);
        for (let i = 0; i < visualStones; i++) {
            const stone = document.createElement('div');
            stone.className = 'stone' + (animate && i >= visualStones - 1 ? ' animated' : '');
            stonesContainer.appendChild(stone);
        }
        
        countEl.textContent = stoneCount;
    }
    
    updateClickablePits() {
        document.querySelectorAll('.pit').forEach(pit => {
            const player = pit.dataset.player;
            const pitIndex = parseInt(pit.dataset.pit);
            
            if (player === this.currentPlayer && this.pits[player][pitIndex] > 0 && !this.gameOver) {
                pit.classList.add('clickable');
                pit.classList.remove('disabled');
            } else {
                pit.classList.remove('clickable');
                pit.classList.add('disabled');
            }
        });
    }
    
    updateTurnIndicator() {
        const text = this.currentPlayer === 'white' ? 'Ақтың ходы' : 'Қараның ходы';
        document.getElementById('turnText').textContent = text;
    }
    
    updateScores() {
        document.getElementById('scoreWhite').textContent = this.kazan.white;
        document.getElementById('scoreBlack').textContent = this.kazan.black;
    }
    
    updateTuzdykIndicators() {
        const whiteIndicator = document.getElementById('tuzdykWhite');
        const blackIndicator = document.getElementById('tuzdykBlack');
        
        if (this.tuzdyk.white !== -1) {
            whiteIndicator.textContent = `Түздық: ${this.tuzdyk.white + 1}`;
        } else {
            whiteIndicator.textContent = '';
        }
        
        if (this.tuzdyk.black !== -1) {
            blackIndicator.textContent = `Түздық: ${this.tuzdyk.black + 1}`;
        } else {
            blackIndicator.textContent = '';
        }
    }
    
    updateLastMove() {
        if (this.lastMove) {
            const playerName = this.lastMove.player === 'white' ? 'Ақ' : 'Қара';
            document.getElementById('lastMove').textContent = 
                `${playerName}: ${this.lastMove.pit}-отау (${this.lastMove.stones} тас)`;
        }
    }
    
    toggleMode() {
        this.gameMode = this.gameMode === 'pvp' ? 'bot' : 'pvp';
        const btn = document.getElementById('modeToggleBtn');
        btn.textContent = this.gameMode === 'pvp' ? 'Режим: 1 vs 1' : 'Режим: vs Бот';
        this.newGame();
    }
    
    newGame() {
        this.state = new GameState();
        this.gameOver = false;
        this.isAnimating = false;
        this.lastMove = null;
        
        document.getElementById('lastMove').textContent = '—';
        const modal = document.getElementById('winModal');
        modal.classList.remove('show');
        modal.style.display = 'none';
        
        this.renderBoard();
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize game
document.addEventListener('DOMContentLoaded', () => {
    window.game = new TogyzQumalaq();
});
