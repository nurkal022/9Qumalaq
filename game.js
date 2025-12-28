/**
 * Тоғызқұмалақ - Traditional Kazakh board game
 * Game logic and AI (Minimax + MCTS + Parallel MCTS)
 */

// ==================== GAME LOGGER (for training data) ====================
class GameLogger {
    constructor() {
        this.games = [];
        this.currentGame = null;
        // Auto-detect server URL (production or local)
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            this.serverUrl = 'http://localhost:5000/api';
        } else {
            // Production: detect if we're in a subpath
            let basePath = '';
            if (pathname.includes('/togyzqumalaq')) {
                basePath = '/togyzqumalaq';
            }
            this.serverUrl = `${window.location.protocol}//${window.location.host}${basePath}/api`;
        }
        this.serverAvailable = false;
        this.checkServerConnection();
    }
    
    async checkServerConnection() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                this.serverAvailable = true;
                console.log('[GameLogger] Server connection: OK');
            } else {
                this.serverAvailable = false;
                console.warn('[GameLogger] Server connection: Failed');
            }
        } catch (e) {
            this.serverAvailable = false;
            console.warn('[GameLogger] Server connection: Unavailable, using localStorage fallback');
        }
    }
    
    async saveToServer(gameData) {
        if (!this.serverAvailable) {
            // Try to reconnect
            await this.checkServerConnection();
            if (!this.serverAvailable) {
                return false;
            }
        }
        
        try {
            const response = await fetch(`${this.serverUrl}/games`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gameData)
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`[GameLogger] Saved to server: ${result.gameId} (Total: ${result.totalGames})`);
                return true;
            } else {
                console.warn('[GameLogger] Server returned error:', response.status);
                this.serverAvailable = false;
                return false;
            }
        } catch (e) {
            console.warn('[GameLogger] Failed to save to server:', e);
            this.serverAvailable = false;
            return false;
        }
    }
    
    async getServerStats() {
        if (!this.serverAvailable) {
            await this.checkServerConnection();
            if (!this.serverAvailable) {
                return null;
            }
        }
        
        try {
            const response = await fetch(`${this.serverUrl}/games/stats`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.warn('[GameLogger] Failed to get server stats:', e);
        }
        return null;
    }
    
    startGame(mode, aiLevel = null) {
        this.currentGame = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: new Date().toISOString(),
            mode: mode,
            aiLevel: aiLevel,
            moves: [],
            states: [],
            aiEvaluations: [],
            result: null
        };
        
        // Log initial state
        this.logState(null);
        
        console.log(`[GameLogger] Game started: ${this.currentGame.id}`);
    }
    
    logMove(player, pitIndex, stones, stateAfter) {
        if (!this.currentGame) return;
        
        const moveData = {
            moveNumber: this.currentGame.moves.length + 1,
            timestamp: Date.now(),
            player,
            pit: pitIndex + 1,
            stones,
            stateAfter: this.serializeState(stateAfter)
        };
        
        this.currentGame.moves.push(moveData);
        console.log(`[GameLogger] Move ${moveData.moveNumber}: ${player} pit ${pitIndex + 1} (${stones} stones)`);
    }
    
    logState(state) {
        if (!this.currentGame) return;
        
        this.currentGame.states.push(state ? this.serializeState(state) : 'initial');
    }
    
    logAIEvaluation(aiType, data) {
        if (!this.currentGame) return;
        
        const evalData = {
            moveNumber: this.currentGame.moves.length + 1,
            timestamp: Date.now(),
            aiType,
            ...data
        };
        
        this.currentGame.aiEvaluations.push(evalData);
        console.log(`[GameLogger] AI Eval (${aiType}):`, data);
    }
    
    async endGame(winner, finalScore) {
        if (!this.currentGame) return;
        
        this.currentGame.result = {
            winner,
            finalScore: { ...finalScore },
            totalMoves: this.currentGame.moves.length,
            duration: Date.now() - new Date(this.currentGame.timestamp).getTime()
        };
        
        this.games.push(this.currentGame);
        
        console.log(`[GameLogger] Game ended: ${winner} wins (${finalScore.white}-${finalScore.black})`);
        console.log(`[GameLogger] Total games logged: ${this.games.length}`);
        
        // Try to save to server first
        const savedToServer = await this.saveToServer(this.currentGame);
        
        if (!savedToServer) {
            // Fallback to localStorage
            this.saveToLocalStorage();
            console.log('[GameLogger] Saved to localStorage (server unavailable)');
        }
        
        // Update UI counter
        const el = document.getElementById('gamesLogged');
        if (el) {
            const serverText = this.serverAvailable ? ' (server)' : ' (local)';
            el.textContent = `${this.games.length} games${serverText}`;
        }
        
        // Also update in game instance if available
        if (window.game && window.game.updateGamesCount) {
            window.game.updateGamesCount().catch(e => console.warn('Error updating games count:', e));
        }
        
        this.currentGame = null;
    }
    
    serializeState(state) {
        return {
            pits: {
                white: [...state.pits.white],
                black: [...state.pits.black]
            },
            kazan: { ...state.kazan },
            tuzdyk: { ...state.tuzdyk },
            currentPlayer: state.currentPlayer
        };
    }
    
    saveToLocalStorage() {
        try {
            const data = JSON.stringify(this.games);
            localStorage.setItem('togyz_game_logs', data);
            console.log(`[GameLogger] Saved ${this.games.length} games to localStorage`);
        } catch (e) {
            console.warn('[GameLogger] Failed to save to localStorage:', e);
        }
    }
    
    loadFromLocalStorage() {
        try {
            const data = localStorage.getItem('togyz_game_logs');
            if (data) {
                this.games = JSON.parse(data);
                console.log(`[GameLogger] Loaded ${this.games.length} games from localStorage`);
            }
        } catch (e) {
            console.warn('[GameLogger] Failed to load from localStorage:', e);
        }
    }
    
    async exportToJSON() {
        let gamesToExport = this.games;
        
        // Try to get games from server if available
        if (this.serverAvailable) {
            try {
                const response = await fetch(`${this.serverUrl}/games/export`);
                if (response.ok) {
                    const data = await response.json();
                    gamesToExport = data.games;
                    console.log(`[GameLogger] Exporting ${gamesToExport.length} games from server`);
                }
            } catch (e) {
                console.warn('[GameLogger] Failed to export from server, using local games:', e);
            }
        }
        
        const blob = new Blob([JSON.stringify(gamesToExport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `togyz_training_data_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        console.log(`[GameLogger] Exported ${gamesToExport.length} games`);
    }
    
    async getStats() {
        // Try to get stats from server first
        const serverStats = await this.getServerStats();
        if (serverStats) {
            return serverStats;
        }
        
        // Fallback to local stats
        const stats = {
            totalGames: this.games.length,
            whiteWins: 0,
            blackWins: 0,
            draws: 0,
            avgMoves: 0,
            avgDuration: 0
        };
        
        let totalMoves = 0;
        let totalDuration = 0;
        
        for (const game of this.games) {
            if (game.result) {
                if (game.result.winner === 'white') stats.whiteWins++;
                else if (game.result.winner === 'black') stats.blackWins++;
                else stats.draws++;
                
                totalMoves += game.result.totalMoves;
                totalDuration += game.result.duration;
            }
        }
        
        if (this.games.length > 0) {
            stats.avgMoves = Math.round(totalMoves / this.games.length);
            stats.avgDuration = Math.round(totalDuration / this.games.length / 1000);
        }
        
        return stats;
    }
    
    clearLogs() {
        this.games = [];
        localStorage.removeItem('togyz_game_logs');
        console.log('[GameLogger] Logs cleared');
    }
}

// Global logger instance
const gameLogger = new GameLogger();
gameLogger.loadFromLocalStorage();

// ==================== GAME STATE ====================
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
    
    toData() {
        return {
            pits: {
                white: [...this.pits.white],
                black: [...this.pits.black]
            },
            kazan: { ...this.kazan },
            tuzdyk: { ...this.tuzdyk },
            currentPlayer: this.currentPlayer
        };
    }
    
    getOpponent(player) {
        return player === 'white' ? 'black' : 'white';
    }
    
    getValidMoves(player) {
        const moves = [];
        const opponent = this.getOpponent(player);
        
        for (let i = 0; i < 9; i++) {
            // Пропускаем лунку, если противник объявил её түздық
            // Түздық противника находится на нашей стороне - мы не можем из неё играть
            if (this.tuzdyk[opponent] === i) continue;
            
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
    
    makeMove(pitIndex) {
        const player = this.currentPlayer;
        const opponent = this.getOpponent(player);
        
        let stones = this.pits[player][pitIndex];
        if (stones === 0) return false;
        
        this.pits[player][pitIndex] = 0;
        
        let currentPit = pitIndex;
        let currentSide = player;
        
        if (stones === 1) {
            currentPit++;
            if (currentPit > 8) {
                currentPit = 0;
                currentSide = opponent;
            }
            
            // Проверяем, является ли лунка чьим-либо түздық
            const isWhiteTuzdyk = currentSide === 'black' && this.tuzdyk.white === currentPit;
            const isBlackTuzdyk = currentSide === 'white' && this.tuzdyk.black === currentPit;
            
            if (isWhiteTuzdyk) {
                this.kazan.white++;
            } else if (isBlackTuzdyk) {
                this.kazan.black++;
            } else {
                this.pits[currentSide][currentPit]++;
            }
        } else {
            this.pits[currentSide][currentPit]++;
            stones--;
            
            while (stones > 0) {
                currentPit++;
                if (currentPit > 8) {
                    currentPit = 0;
                    currentSide = currentSide === 'white' ? 'black' : 'white';
                }
                
                // Проверяем, является ли лунка чьим-либо түздық
                const isWhiteTuzdykLoop = currentSide === 'black' && this.tuzdyk.white === currentPit;
                const isBlackTuzdykLoop = currentSide === 'white' && this.tuzdyk.black === currentPit;
                
                if (isWhiteTuzdykLoop) {
                    this.kazan.white++;
                } else if (isBlackTuzdykLoop) {
                    this.kazan.black++;
                } else {
                    this.pits[currentSide][currentPit]++;
                }
                stones--;
            }
        }
        
        // Проверка на захват и создание түздық (только если это НЕ түздық)
        const isAnyTuzdyk = (currentSide === 'black' && this.tuzdyk.white === currentPit) ||
                           (currentSide === 'white' && this.tuzdyk.black === currentPit);
        
        if (currentSide === opponent && !isAnyTuzdyk) {
            const count = this.pits[opponent][currentPit];
            
            if (count === 3 && this.canCreateTuzdyk(player, currentPit)) {
                this.tuzdyk[player] = currentPit;
                this.kazan[player] += count;
                this.pits[opponent][currentPit] = 0;
            }
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
    
    quickEvaluate(player) {
        const opp = this.getOpponent(player);
        return (this.kazan[player] - this.kazan[opp]) + 
               (this.tuzdyk[player] !== -1 ? 10 : 0) -
               (this.tuzdyk[opp] !== -1 ? 10 : 0);
    }
}

// ==================== MCTS NODE ====================
class MCTSNode {
    constructor(state, parent = null, move = null) {
        this.state = state;
        this.parent = parent;
        this.move = move;
        this.children = [];
        this.wins = 0;
        this.visits = 0;
        this.untriedMoves = state.getValidMoves(state.currentPlayer);
    }
    
    isFullyExpanded() {
        return this.untriedMoves.length === 0;
    }
    
    hasChildren() {
        return this.children.length > 0;
    }
    
    getUCTValue(explorationWeight) {
        if (this.visits === 0) return Infinity;
        return (this.wins / this.visits) + 
               explorationWeight * Math.sqrt(Math.log(this.parent.visits) / this.visits);
    }
    
    selectChild(explorationWeight) {
        let best = null;
        let bestValue = -Infinity;
        
        for (const child of this.children) {
            const uct = child.getUCTValue(explorationWeight);
            if (uct > bestValue) {
                bestValue = uct;
                best = child;
            }
        }
        return best;
    }
    
    expand() {
        const move = this.untriedMoves.pop();
        const newState = this.state.clone();
        newState.makeMove(move);
        
        const childNode = new MCTSNode(newState, this, move);
        this.children.push(childNode);
        return childNode;
    }
    
    update(winner, aiPlayer) {
        this.visits++;
        if (winner === aiPlayer) {
            this.wins += 1;
        } else if (winner === 'draw') {
            this.wins += 0.5;
        }
    }
    
    getBestMove() {
        let best = null;
        let bestVisits = -1;
        
        for (const child of this.children) {
            if (child.visits > bestVisits) {
                bestVisits = child.visits;
                best = child;
            }
        }
        return best ? best.move : null;
    }
}

// ==================== MCTS AI ====================
class MCTSAI {
    constructor(simulations = 5000, timeLimit = 3000, explorationWeight = 1.41) {
        this.simulations = simulations;
        this.timeLimit = timeLimit;
        this.C = explorationWeight;
        this.simulationsRun = 0;
    }
    
    simulate(state, aiPlayer) {
        const simState = state.clone();
        let moveCount = 0;
        const maxMoves = 200;
        
        while (!simState.isGameOver() && moveCount < maxMoves) {
            const moves = simState.getValidMoves(simState.currentPlayer);
            if (moves.length === 0) break;
            
            let selectedMove;
            
            if (Math.random() < 0.7) {
                let bestScore = -Infinity;
                selectedMove = moves[0];
                
                for (const move of moves) {
                    const testState = simState.clone();
                    const kazanBefore = testState.kazan[testState.currentPlayer];
                    testState.makeMove(move);
                    const kazanAfter = testState.kazan[simState.currentPlayer];
                    const score = kazanAfter - kazanBefore + Math.random() * 0.5;
                    
                    if (score > bestScore) {
                        bestScore = score;
                        selectedMove = move;
                    }
                }
            } else {
                selectedMove = moves[Math.floor(Math.random() * moves.length)];
            }
            
            simState.makeMove(selectedMove);
            moveCount++;
        }
        
        return simState.getWinner();
    }
    
    search(rootState, aiPlayer) {
        const root = new MCTSNode(rootState.clone());
        const startTime = Date.now();
        this.simulationsRun = 0;
        
        while (this.simulationsRun < this.simulations && 
               (Date.now() - startTime) < this.timeLimit) {
            
            let node = root;
            
            while (node.isFullyExpanded() && node.hasChildren()) {
                node = node.selectChild(this.C);
            }
            
            if (!node.state.isGameOver() && !node.isFullyExpanded()) {
                node = node.expand();
            }
            
            const winner = this.simulate(node.state, aiPlayer);
            
            while (node !== null) {
                node.update(winner, aiPlayer);
                node = node.parent;
            }
            
            this.simulationsRun++;
        }
        
        return root;
    }
    
    getBestMove(state, player) {
        const root = this.search(state, player);
        const bestMove = root.getBestMove();
        
        const bestChild = root.children.find(c => c.move === bestMove);
        let winRate = 0;
        let moveStats = [];
        
        if (bestChild) {
            winRate = bestChild.wins / bestChild.visits;
            moveStats = root.children.map(c => ({
                move: c.move + 1,
                visits: c.visits,
                winRate: (c.wins / c.visits * 100).toFixed(1) + '%'
            }));
        }
        
        console.log(`MCTS: ${this.simulationsRun} simulations, move: ${bestMove + 1}, win rate: ${(winRate * 100).toFixed(1)}%`);
        
        // Log for training
        gameLogger.logAIEvaluation('mcts', {
            simulations: this.simulationsRun,
            bestMove: bestMove + 1,
            winRate: winRate,
            moveStats
        });
        
        return bestMove;
    }
}

// ==================== PARALLEL MCTS AI (Web Worker) ====================
class ParallelMCTSAI {
    constructor(simulations = 100000, timeLimit = 30000) {
        this.simulations = simulations;
        this.timeLimit = timeLimit;
        this.worker = null;
        this.onProgress = null;
    }
    
    async getBestMove(state, player) {
        return new Promise((resolve, reject) => {
            // Create worker
            this.worker = new Worker('mcts-worker.js');
            
            this.worker.onmessage = (e) => {
                if (e.data.type === 'progress') {
                    console.log(`[ParallelMCTS] Progress: ${e.data.simulations} simulations, ${e.data.elapsed}ms`);
                    if (this.onProgress) {
                        this.onProgress(e.data);
                    }
                } else if (e.data.type === 'result') {
                    const { bestMove, simulations, elapsed, winRate, moveStats } = e.data;
                    
                    console.log(`ParallelMCTS: ${simulations} simulations in ${elapsed}ms, move: ${bestMove + 1}, win rate: ${(winRate * 100).toFixed(1)}%`);
                    
                    // Log for training
                    gameLogger.logAIEvaluation('parallel-mcts', {
                        simulations,
                        elapsed,
                        bestMove: bestMove + 1,
                        winRate,
                        moveStats
                    });
                    
                    this.worker.terminate();
                    this.worker = null;
                    resolve(bestMove);
                }
            };
            
            this.worker.onerror = (e) => {
                console.error('[ParallelMCTS] Worker error:', e);
                this.worker.terminate();
                this.worker = null;
                reject(e);
            };
            
            // Send state to worker
            this.worker.postMessage({
                stateData: state.toData(),
                aiPlayer: player,
                simulations: this.simulations,
                timeLimit: this.timeLimit
            });
        });
    }
    
    cancel() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

// ==================== MINIMAX AI ====================
class MinimaxAI {
    constructor(maxDepth = 6) {
        this.maxDepth = maxDepth;
        this.nodesEvaluated = 0;
    }
    
    minimax(state, depth, alpha, beta, maximizingPlayer, aiPlayer) {
        this.nodesEvaluated++;
        
        if (depth === 0 || state.isGameOver()) {
            return { score: this.evaluate(state, aiPlayer), move: null };
        }
        
        const moves = state.getValidMoves(state.currentPlayer);
        if (moves.length === 0) {
            return { score: this.evaluate(state, aiPlayer), move: null };
        }
        
        const orderedMoves = this.orderMoves(state, moves, state.currentPlayer);
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
                if (beta <= alpha) break;
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
    
    orderMoves(state, moves, player) {
        const opponent = state.getOpponent(player);
        const scored = moves.map(move => {
            let priority = 0;
            const stones = state.pits[player][move];
            
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
            
            if (side === opponent) {
                const targetStones = state.pits[opponent][pos] + 1;
                if (targetStones === 3 && state.canCreateTuzdyk(player, pos)) {
                    priority += 50;
                } else if (targetStones % 2 === 0) {
                    priority += targetStones * 2;
                }
            }
            
            return { move, priority };
        });
        
        scored.sort((a, b) => b.priority - a.priority);
        return scored.map(s => s.move);
    }
    
    evaluate(state, aiPlayer) {
        const opponent = state.getOpponent(aiPlayer);
        let score = 0;
        
        score += (state.kazan[aiPlayer] - state.kazan[opponent]) * 10;
        
        if (state.kazan[aiPlayer] >= 82) return 10000;
        if (state.kazan[opponent] >= 82) return -10000;
        
        if (state.tuzdyk[aiPlayer] !== -1) {
            const pos = state.tuzdyk[aiPlayer];
            score += 25 + (4 - Math.abs(4 - pos)) * 3;
        }
        if (state.tuzdyk[opponent] !== -1) {
            const pos = state.tuzdyk[opponent];
            score -= 25 + (4 - Math.abs(4 - pos)) * 3;
        }
        
        if (state.tuzdyk[aiPlayer] === -1) {
            for (let i = 0; i < 8; i++) {
                if (state.pits[opponent][i] === 2 && state.canCreateTuzdyk(aiPlayer, i)) {
                    score += 8;
                }
            }
        }
        
        for (let i = 0; i < 9; i++) {
            const myStones = state.pits[aiPlayer][i];
            const oppStones = state.pits[opponent][i];
            const centerBonus = (i >= 3 && i <= 5) ? 1.2 : 1.0;
            
            score += myStones * 0.3 * centerBonus;
            score -= oppStones * 0.3 * centerBonus;
        }
        
        const myMoves = state.getValidMoves(aiPlayer).length;
        const oppMoves = state.getValidMoves(opponent).length;
        score += (myMoves - oppMoves) * 1.5;
        
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
        
        console.log(`Minimax: ${this.nodesEvaluated} nodes, move: ${result.move + 1}, score: ${result.score.toFixed(1)}`);
        
        // Log for training
        gameLogger.logAIEvaluation('minimax', {
            depth: this.maxDepth,
            nodesEvaluated: this.nodesEvaluated,
            bestMove: result.move + 1,
            score: result.score
        });
        
        return result.move;
    }
}

// ==================== AI DIFFICULTY LEVELS ====================
const AI_LEVELS = {
    easy: {
        name: 'Жеңіл',
        type: 'minimax',
        depth: 2
    },
    medium: {
        name: 'Орташа', 
        type: 'minimax',
        depth: 4
    },
    hard: {
        name: 'Қиын',
        type: 'minimax',
        depth: 6
    },
    expert: {
        name: 'Эксперт',
        type: 'mcts',
        simulations: 5000,
        timeLimit: 2000
    },
    master: {
        name: 'Мастер',
        type: 'mcts',
        simulations: 15000,
        timeLimit: 5000
    },
    grandmaster: {
        name: 'Гроссмейстер',
        type: 'mcts',
        simulations: 30000,
        timeLimit: 10000
    },
    super: {
        name: 'Супер',
        type: 'parallel-mcts',
        simulations: 100000,
        timeLimit: 30000
    }
};

// ==================== MAIN GAME CLASS ====================
class TogyzQumalaq {
    constructor(mode = 'pvp', difficulty = 'hard') {
        this.state = new GameState();
        this.gameOver = false;
        this.isAnimating = false;
        this.gameMode = mode;
        this.aiLevel = difficulty;
        this.lastMove = null;
        this.animationDelay = 60;
        
        // Счёт серии игр
        this.seriesScore = { white: 0, black: 0 };
        
        this.ai = this.createAI(this.aiLevel);
        
        this.initUI();
        this.updateModeButton();
        this.updateDifficultyButton();
        this.newGame();  // Initialize with a new game (hides modal, starts logging)
    }
    
    updateModeButton() {
        const btn = document.getElementById('modeToggleBtn');
        if (btn) {
            btn.textContent = this.gameMode === 'pvp' ? 'Режим: 1 vs 1' : 'Режим: vs Бот';
        }
    }
    
    updateDifficultyButton() {
        const btn = document.getElementById('difficultyBtn');
        if (btn) {
            btn.textContent = `AI: ${AI_LEVELS[this.aiLevel].name}`;
        }
    }
    
    createAI(level) {
        const config = AI_LEVELS[level];
        if (config.type === 'parallel-mcts') {
            return new ParallelMCTSAI(config.simulations, config.timeLimit);
        } else if (config.type === 'mcts') {
            return new MCTSAI(config.simulations, config.timeLimit);
        } else {
            return new MinimaxAI(config.depth);
        }
    }
    
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
        document.getElementById('menuBtn').addEventListener('click', () => this.backToMenu());
        document.getElementById('playAgainBtn').addEventListener('click', () => {
            document.getElementById('winModal').classList.remove('show');
            this.newGame();
        });
        
        const difficultyBtn = document.getElementById('difficultyBtn');
        if (difficultyBtn) {
            difficultyBtn.addEventListener('click', () => this.cycleDifficulty());
        }
        
        // Logger controls
        const exportBtn = document.getElementById('exportDataBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                await gameLogger.exportToJSON();
            });
        }
        
        const statsBtn = document.getElementById('logStatsBtn');
        if (statsBtn) {
            statsBtn.addEventListener('click', async () => {
                const stats = await gameLogger.getStats();
                const source = gameLogger.serverAvailable ? ' (server)' : ' (local)';
                alert(`📊 Game Stats${source}:\n\nTotal Games: ${stats.totalGames}\nWhite Wins: ${stats.whiteWins}\nBlack Wins: ${stats.blackWins}\nDraws: ${stats.draws}\nAvg Moves: ${stats.avgMoves}\nAvg Duration: ${stats.avgDuration}s`);
            });
        }
        
        this.updateGamesCount().catch(e => console.warn('Error updating games count:', e));
    }
    
    async updateGamesCount() {
        const el = document.getElementById('gamesLogged');
        if (el) {
            // Check server status
            await gameLogger.checkServerConnection();
            const serverText = gameLogger.serverAvailable ? ' (server)' : ' (local)';
            el.textContent = `${gameLogger.games.length} games${serverText}`;
        }
    }
    
    cycleDifficulty() {
        const levels = Object.keys(AI_LEVELS);
        const currentIndex = levels.indexOf(this.aiLevel);
        const nextIndex = (currentIndex + 1) % levels.length;
        this.aiLevel = levels[nextIndex];
        this.ai = this.createAI(this.aiLevel);
        
        const btn = document.getElementById('difficultyBtn');
        if (btn) {
            btn.textContent = `AI: ${AI_LEVELS[this.aiLevel].name}`;
        }
        
        console.log(`AI level changed to: ${this.aiLevel} (${AI_LEVELS[this.aiLevel].type})`);
    }
    
    handlePitClick(pitElement) {
        if (this.gameOver || this.isAnimating) return;
        
        const player = pitElement.dataset.player;
        const pitIndex = parseInt(pitElement.dataset.pit);
        
        if (player !== this.currentPlayer) return;
        if (this.pits[player][pitIndex] === 0) return;
        
        // Нельзя играть из лунки, которую противник объявил түздық
        const opponent = player === 'white' ? 'black' : 'white';
        if (this.tuzdyk[opponent] === pitIndex) return;
        
        this.makeMove(pitIndex);
    }
    
    async makeMove(pitIndex) {
        const player = this.currentPlayer;
        const opponent = player === 'white' ? 'black' : 'white';
        
        let stones = this.pits[player][pitIndex];
        if (stones === 0) return;
        
        this.isAnimating = true;
        this.lastMove = { player, fromPit: pitIndex + 1, toPit: null, toSide: null, stones };
        
        if (stones === 1) {
            this.pits[player][pitIndex] = 0;
            
            let nextPit = pitIndex + 1;
            let nextSide = player;
            
            if (nextPit > 8) {
                nextPit = 0;
                nextSide = opponent;
            }
            
            // Сохраняем конечную позицию
            this.lastMove.toPit = nextPit + 1;
            this.lastMove.toSide = nextSide;
            
            await this.delay(this.animationDelay);
            
            // Проверяем, является ли лунка чьим-либо түздық
            // Түздық белого находится на стороне черного и наоборот
            const isWhiteTuzdyk = nextSide === 'black' && this.tuzdyk.white === nextPit;
            const isBlackTuzdyk = nextSide === 'white' && this.tuzdyk.black === nextPit;
            
            if (isWhiteTuzdyk) {
                this.kazan.white++;
                this.renderKazan('white', true);
            } else if (isBlackTuzdyk) {
                this.kazan.black++;
                this.renderKazan('black', true);
            } else {
                this.pits[nextSide][nextPit]++;
                this.renderBoard();
            }
            
            // Проверка на захват и создание түздық (только если это НЕ түздық)
            const nextIsAnyTuzdyk = (nextSide === 'black' && this.tuzdyk.white === nextPit) ||
                                    (nextSide === 'white' && this.tuzdyk.black === nextPit);
            
            if (nextSide === opponent && !nextIsAnyTuzdyk) {
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
                
                // Проверяем, является ли лунка чьим-либо түздық
                const isWhiteTuzdykLoop = currentSide === 'black' && this.tuzdyk.white === currentPit;
                const isBlackTuzdykLoop = currentSide === 'white' && this.tuzdyk.black === currentPit;
                
                if (isWhiteTuzdykLoop) {
                    await this.delay(this.animationDelay);
                    this.kazan.white++;
                    this.renderKazan('white', true);
                    stones--;
                    continue;
                }
                
                if (isBlackTuzdykLoop) {
                    await this.delay(this.animationDelay);
                    this.kazan.black++;
                    this.renderKazan('black', true);
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
            
            // Сохраняем конечную позицию
            this.lastMove.toPit = lastPit + 1;
            this.lastMove.toSide = lastSide;
            
            // Проверка на захват и создание түздық (только если это НЕ түздық)
            const lastIsAnyTuzdyk = (lastSide === 'black' && this.tuzdyk.white === lastPit) ||
                                    (lastSide === 'white' && this.tuzdyk.black === lastPit);
            
            if (lastSide === opponent && !lastIsAnyTuzdyk) {
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
        
        // Log move
        gameLogger.logMove(player, pitIndex, this.lastMove.stones, this.state);
        
        this.updateLastMove();
        this.isAnimating = false;
        
        if (this.checkWin()) {
            this.endGame();
            return;
        }
        
        this.state.currentPlayer = opponent;
        this.updateTurnIndicator();
        this.updateClickablePits();
        
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
        
        // Обновляем счёт серии
        if (winner === 'white') {
            this.seriesScore.white++;
        } else if (winner === 'black') {
            this.seriesScore.black++;
        }
        
        // Log game end (async, but don't wait)
        gameLogger.endGame(winner, this.kazan).catch(e => {
            console.warn('[GameLogger] Error ending game:', e);
        });
        
        const winnerText = document.getElementById('winnerText');
        const finalScore = document.getElementById('finalScore');
        
        if (winner === 'draw') {
            winnerText.textContent = 'Тең ойын!';
        } else {
            const winnerName = winner === 'white' ? 'Ақ' : 'Қара';
            winnerText.textContent = `${winnerName} жеңді!`;
        }
        
        finalScore.textContent = `Есеп: Ақ ${this.kazan.white} - ${this.kazan.black} Қара`;
        
        this.updateSeriesScore();
        
        const modal = document.getElementById('winModal');
        modal.style.display = 'flex';
        modal.classList.add('show');
    }
    
    async makeBotMove() {
        if (this.gameOver || this.isAnimating) return;
        
        const validMoves = this.state.getValidMoves('black');
        if (validMoves.length === 0) return;
        
        // Show thinking indicator
        const config = AI_LEVELS[this.aiLevel];
        if (config.type === 'parallel-mcts') {
            document.getElementById('turnText').textContent = 'AI ойлануда (Супер)... 🧠';
        } else {
            document.getElementById('turnText').textContent = 'AI ойлануда...';
        }
        
        await this.delay(50);
        
        try {
            const bestMove = await this.ai.getBestMove(this.state, 'black');
            
            if (bestMove !== null && !this.gameOver) {
                await this.makeMove(bestMove);
            }
        } catch (e) {
            console.error('AI error:', e);
            // Fallback to random move
            const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
            await this.makeMove(randomMove);
        }
    }
    
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
        const opponent = this.currentPlayer === 'white' ? 'black' : 'white';
        
        document.querySelectorAll('.pit').forEach(pit => {
            const player = pit.dataset.player;
            const pitIndex = parseInt(pit.dataset.pit);
            
            // Лунка кликабельна если:
            // 1. Это лунка текущего игрока
            // 2. В ней есть камни
            // 3. Игра не окончена
            // 4. Это НЕ лунка түздық противника (противник объявил нашу лунку түздық - мы не можем из неё играть)
            const isTuzdykOfOpponent = this.tuzdyk[opponent] === pitIndex;
            
            if (player === this.currentPlayer && 
                this.pits[player][pitIndex] > 0 && 
                !this.gameOver && 
                !isTuzdykOfOpponent) {
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
    
    updateSeriesScore() {
        const seriesEl = document.getElementById('seriesScore');
        if (seriesEl) {
            const total = this.seriesScore.white + this.seriesScore.black;
            if (total > 0) {
                seriesEl.textContent = `Серия: Ақ ${this.seriesScore.white} - ${this.seriesScore.black} Қара`;
                seriesEl.style.display = 'block';
            } else {
                seriesEl.style.display = 'none';
            }
        }
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
            const fromPit = this.lastMove.fromPit;
            const toPit = this.lastMove.toPit;
            const toSide = this.lastMove.toSide;
            const stones = this.lastMove.stones;
            
            // Определяем, куда пришёл последний камень
            let destination;
            if (toSide === this.lastMove.player) {
                destination = `${toPit}-отауға`; // На свою сторону
            } else {
                destination = `қарсылас ${toPit}-отауға`; // На сторону противника
            }
            
            document.getElementById('lastMove').textContent = 
                `${playerName}: ${fromPit}-отаудан → ${destination} (${stones} тас)`;
        }
    }
    
    toggleMode() {
        this.gameMode = this.gameMode === 'pvp' ? 'bot' : 'pvp';
        this.updateModeButton();
        this.newGame();
    }
    
    backToMenu() {
        // Cancel any running AI
        if (this.ai && this.ai.cancel) {
            this.ai.cancel();
        }
        
        // Hide game container
        document.getElementById('gameContainer').style.display = 'none';
        
        // Show start screen
        document.getElementById('startScreen').classList.remove('hidden');
    }
    
    newGame() {
        // Cancel any running AI
        if (this.ai && this.ai.cancel) {
            this.ai.cancel();
        }
        
        this.state = new GameState();
        this.gameOver = false;
        this.isAnimating = false;
        this.lastMove = null;
        
        // В режиме бота: 50% вероятность что бот начинает первым
        if (this.gameMode === 'bot' && Math.random() < 0.5) {
            this.state.currentPlayer = 'black';
        } else {
            this.state.currentPlayer = 'white';
        }
        
        // Start logging new game
        gameLogger.startGame(this.gameMode, this.gameMode === 'bot' ? this.aiLevel : null);
        
        document.getElementById('lastMove').textContent = '—';
        const modal = document.getElementById('winModal');
        modal.classList.remove('show');
        modal.style.display = 'none';
        
        this.renderBoard();
        this.updateTurnIndicator();
        this.updateClickablePits();
        this.updateSeriesScore();
        
        // Если бот начинает первым, делаем его ход
        if (this.gameMode === 'bot' && this.state.currentPlayer === 'black' && !this.gameOver) {
            setTimeout(() => {
                this.makeBotMove();
            }, 500);
        }
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== START SCREEN ====================
class StartScreen {
    constructor() {
        this.selectedMode = 'pvp';
        this.selectedDifficulty = 'hard';
        this.initUI();
    }
    
    initUI() {
        // Mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => this.selectMode(btn.dataset.mode));
        });
        
        // Difficulty buttons
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', () => this.selectDifficulty(btn.dataset.level));
        });
        
        // Start game button
        document.getElementById('startGameBtn').addEventListener('click', () => this.startGame());
    }
    
    selectMode(mode) {
        this.selectedMode = mode;
        
        // Update button states
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        // Show/hide difficulty section
        const diffSection = document.getElementById('difficultySection');
        if (mode === 'bot') {
            diffSection.style.display = 'block';
        } else {
            diffSection.style.display = 'none';
        }
    }
    
    selectDifficulty(level) {
        this.selectedDifficulty = level;
        
        // Update button states
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.level === level);
        });
    }
    
    startGame() {
        // Hide start screen
        document.getElementById('startScreen').classList.add('hidden');
        
        // Show game container
        document.getElementById('gameContainer').style.display = 'block';
        
        // Initialize game with selected settings
        window.game = new TogyzQumalaq(this.selectedMode, this.selectedDifficulty);
    }
}

// ==================== CONSOLE COMMANDS ====================
// Expose logger functions for console use
window.togyzLogger = {
    export: () => gameLogger.exportToJSON(),
    stats: async () => {
        const stats = await gameLogger.getStats();
        console.table(stats);
    },
    clear: () => gameLogger.clearLogs(),
    games: () => gameLogger.games
};

console.log('%c🎮 Тоғызқұмалақ Training Logger', 'font-size: 16px; font-weight: bold;');
console.log('Commands: togyzLogger.export(), togyzLogger.stats(), togyzLogger.clear(), togyzLogger.games');

// Initialize start screen
document.addEventListener('DOMContentLoaded', () => {
    window.startScreen = new StartScreen();
});
