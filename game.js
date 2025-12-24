/**
 * Тоғызқұмалақ - Traditional Kazakh board game
 * Game logic and UI management
 */

class TogyzQumalaq {
    constructor() {
        // Game state
        this.pits = {
            white: [9, 9, 9, 9, 9, 9, 9, 9, 9], // Player 1 (bottom)
            black: [9, 9, 9, 9, 9, 9, 9, 9, 9]  // Player 2 (top)
        };
        this.kazan = {
            white: 0,
            black: 0
        };
        this.tuzdyk = {
            white: -1, // Index of opponent's pit that is white's tuzdyk
            black: -1  // Index of opponent's pit that is black's tuzdyk
        };
        this.currentPlayer = 'white'; // White starts first
        this.gameOver = false;
        this.isAnimating = false;
        this.gameMode = 'pvp'; // 'pvp' or 'bot'
        this.lastMove = null;
        
        // Animation settings
        this.animationDelay = 80; // ms per stone
        
        // Initialize UI
        this.initUI();
        this.renderBoard();
    }
    
    initUI() {
        // Pit click handlers
        document.querySelectorAll('.pit').forEach(pit => {
            pit.addEventListener('click', () => this.handlePitClick(pit));
        });
        
        // Control buttons
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
        
        // Can only click own pits on your turn
        if (player !== this.currentPlayer) return;
        
        // Can't click empty pits
        if (this.pits[player][pitIndex] === 0) return;
        
        // Execute move
        this.makeMove(pitIndex);
    }
    
    async makeMove(pitIndex) {
        const player = this.currentPlayer;
        const opponent = player === 'white' ? 'black' : 'white';
        
        // Get stones from selected pit
        let stones = this.pits[player][pitIndex];
        if (stones === 0) return;
        
        this.isAnimating = true;
        this.lastMove = { player, pit: pitIndex + 1, stones };
        
        // Special case: only 1 stone - move to next pit
        if (stones === 1) {
            this.pits[player][pitIndex] = 0;
            
            // Next position
            let nextPit = pitIndex + 1;
            let nextSide = player;
            
            if (nextPit > 8) {
                nextPit = 0;
                nextSide = opponent;
            }
            
            // Animate
            await this.animateStoneMove(player, pitIndex, nextSide, nextPit);
            
            // Add stone
            this.pits[nextSide][nextPit]++;
            this.renderBoard();
            
            // Check tuzdyk capture
            if (nextSide === opponent && this.tuzdyk[player] === nextPit) {
                await this.delay(200);
                await this.captureToKazan(player, opponent, nextPit);
            }
            // Check normal capture or tuzdyk creation
            else if (nextSide === opponent) {
                const count = this.pits[opponent][nextPit];
                
                // Tuzdyk creation: exactly 3 stones
                if (count === 3 && this.canCreateTuzdyk(player, nextPit)) {
                    await this.delay(200);
                    this.tuzdyk[player] = nextPit;
                    await this.captureToKazan(player, opponent, nextPit);
                }
                // Normal capture: even number
                else if (count % 2 === 0) {
                    await this.delay(200);
                    await this.captureToKazan(player, opponent, nextPit);
                }
            }
        } else {
            // Normal move: distribute all stones
            this.pits[player][pitIndex] = 0;
            this.renderBoard();
            
            let currentPit = pitIndex;
            let currentSide = player;
            
            // First stone goes into the same pit
            await this.delay(this.animationDelay);
            this.pits[currentSide][currentPit]++;
            this.renderPit(currentSide, currentPit, true);
            stones--;
            
            // Distribute remaining stones
            while (stones > 0) {
                // Move to next pit
                currentPit++;
                if (currentPit > 8) {
                    currentPit = 0;
                    currentSide = currentSide === 'white' ? 'black' : 'white';
                }
                
                // Skip tuzdyk of current moving player (stones go to kazan)
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
            
            // Last stone position
            const lastPit = currentPit;
            const lastSide = currentSide;
            
            // Check captures if last stone landed on opponent's side
            if (lastSide === opponent) {
                const count = this.pits[opponent][lastPit];
                
                // Check if this pit is already opponent's tuzdyk (shouldn't happen but safety check)
                if (this.tuzdyk[opponent] === lastPit) {
                    // Do nothing, stones already captured during distribution
                }
                // Tuzdyk creation: exactly 3 stones
                else if (count === 3 && this.canCreateTuzdyk(player, lastPit)) {
                    await this.delay(200);
                    this.tuzdyk[player] = lastPit;
                    await this.captureToKazan(player, opponent, lastPit);
                }
                // Normal capture: even number
                else if (count % 2 === 0) {
                    await this.delay(200);
                    await this.captureToKazan(player, opponent, lastPit);
                }
            }
        }
        
        // Update display
        this.updateLastMove();
        this.isAnimating = false;
        
        // Check win condition
        if (this.checkWin()) {
            this.endGame();
            return;
        }
        
        // Switch turn
        this.currentPlayer = opponent;
        this.updateTurnIndicator();
        this.updateClickablePits();
        
        // Bot move
        if (this.gameMode === 'bot' && this.currentPlayer === 'black' && !this.gameOver) {
            await this.delay(500);
            this.makeBotMove();
        }
    }
    
    canCreateTuzdyk(player, opponentPitIndex) {
        // Rule 1: Can only have one tuzdyk
        if (this.tuzdyk[player] !== -1) return false;
        
        // Rule 2: Cannot create tuzdyk on pit 9 (index 8)
        if (opponentPitIndex === 8) return false;
        
        // Rule 3: Cannot create tuzdyk on symmetric position if opponent has tuzdyk
        const opponent = player === 'white' ? 'black' : 'white';
        if (this.tuzdyk[opponent] === opponentPitIndex) return false;
        
        return true;
    }
    
    async captureToKazan(player, opponent, pitIndex) {
        const stones = this.pits[opponent][pitIndex];
        if (stones === 0) return;
        
        // Animate capture
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
    
    async animateStoneMove(fromSide, fromPit, toSide, toPit) {
        await this.delay(this.animationDelay);
    }
    
    checkWin() {
        // Win condition: 82 or more stones in kazan
        if (this.kazan.white >= 82) return 'white';
        if (this.kazan.black >= 82) return 'black';
        
        // Check if one player has no valid moves (all pits empty)
        const whiteEmpty = this.pits.white.every(p => p === 0);
        const blackEmpty = this.pits.black.every(p => p === 0);
        
        if (whiteEmpty || blackEmpty) {
            // Game ends - count total
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
    
    // Bot AI
    async makeBotMove() {
        if (this.gameOver || this.isAnimating) return;
        
        const validMoves = this.getValidMoves('black');
        if (validMoves.length === 0) return;
        
        // Simple AI: evaluate each move
        let bestMove = validMoves[0];
        let bestScore = -Infinity;
        
        for (const pitIndex of validMoves) {
            const score = this.evaluateMove('black', pitIndex);
            if (score > bestScore) {
                bestScore = score;
                bestMove = pitIndex;
            }
        }
        
        await this.makeMove(bestMove);
    }
    
    getValidMoves(player) {
        const moves = [];
        for (let i = 0; i < 9; i++) {
            if (this.pits[player][i] > 0) {
                moves.push(i);
            }
        }
        return moves;
    }
    
    evaluateMove(player, pitIndex) {
        // Clone state
        const originalPits = JSON.parse(JSON.stringify(this.pits));
        const originalKazan = { ...this.kazan };
        const originalTuzdyk = { ...this.tuzdyk };
        
        const opponent = player === 'white' ? 'black' : 'white';
        let score = 0;
        
        // Simulate move
        let stones = this.pits[player][pitIndex];
        this.pits[player][pitIndex] = 0;
        
        let currentPit = pitIndex;
        let currentSide = player;
        
        // First stone in same pit
        this.pits[currentSide][currentPit]++;
        stones--;
        
        // Distribute
        while (stones > 0) {
            currentPit++;
            if (currentPit > 8) {
                currentPit = 0;
                currentSide = currentSide === 'white' ? 'black' : 'white';
            }
            
            if (currentSide !== player && this.tuzdyk[player] === currentPit) {
                this.kazan[player]++;
                score += 2; // Bonus for tuzdyk capture
            } else {
                this.pits[currentSide][currentPit]++;
            }
            stones--;
        }
        
        // Check capture potential
        if (currentSide === opponent) {
            const count = this.pits[opponent][currentPit];
            
            if (count === 3 && this.canCreateTuzdyk(player, currentPit)) {
                score += 15 + count; // Tuzdyk is very valuable
            } else if (count % 2 === 0) {
                score += count; // Capture value
            }
        }
        
        // Restore state
        this.pits = originalPits;
        this.kazan = originalKazan;
        this.tuzdyk = originalTuzdyk;
        
        // Add some randomness for variety
        score += Math.random() * 2;
        
        return score;
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
        
        // Clear container
        container.innerHTML = '';
        
        // Max 10 stones per layer (2 columns × 5 rows)
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
        
        // Update count
        countEl.textContent = stoneCount;
        
        // Update tuzdyk visual
        const opponent = player === 'white' ? 'black' : 'white';
        if (this.tuzdyk[opponent] === pitIndex) {
            pit.classList.add('tuzdyk');
        } else {
            pit.classList.remove('tuzdyk');
        }
        
        // Highlight animation
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
        
        // Only show limited visual stones (for performance)
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
        this.pits = {
            white: [9, 9, 9, 9, 9, 9, 9, 9, 9],
            black: [9, 9, 9, 9, 9, 9, 9, 9, 9]
        };
        this.kazan = { white: 0, black: 0 };
        this.tuzdyk = { white: -1, black: -1 };
        this.currentPlayer = 'white';
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

