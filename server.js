const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const lobbies = {};

function generateCode() { return Math.random().toString(36).substring(2,6).toUpperCase(); }

wss.on('connection', ws => {
    ws.id = uuidv4();
    ws.on('message', msg => {
        let data;
        try { data = JSON.parse(msg); } catch { return; }
        handleMessage(ws, data);
    });
});

function handleMessage(ws, data) {
    const { type, payload } = data;
    switch(type) {
        case 'joinLobby':
            const { lobbyCode, name } = payload;
            let lobby = lobbies[lobbyCode];
            if(!lobby) { ws.send(JSON.stringify({ type:'error', payload:'Lobby not found' })); return; }

            const isVIP = lobby.players.length===0;
            const player = { id: ws.id, name, isVIP, score:0 };
            lobby.players.push(player);
            ws.lobbyCode = lobbyCode;
            broadcast(lobbyCode, { type:'lobbyUpdate', payload:{ players:lobby.players } });
            break;

        case 'createLobby':
            const code = generateCode();
            lobbies[code] = { code, players:[], currentRound:null };
            ws.send(JSON.stringify({ type:'lobbyCreated', payload:{ code } }));
            break;

        case 'startRound':
            startRound(ws); break;
        case 'submitResponse':
            submitResponse(ws, payload.response); break;
        case 'submitVote':
            submitVote(ws, payload.voteForId); break;
        case 'nextRound':
            nextRound(ws); break;
    }
}

function broadcast(code, msg) {
    const lobby = lobbies[code];
    if(!lobby) return;
    const str = JSON.stringify(msg);
    lobby.players.forEach(p => {
        const conn = Array.from(wss.clients).find(c=>c.id===p.id);
        if(conn) conn.send(str);
    });
}

function startRound(ws) {
    const lobby = lobbies[ws.lobbyCode]; if(!lobby) return;
    const fakerIndex = Math.floor(Math.random()*lobby.players.length);
    const fakerId = lobby.players[fakerIndex].id;
    const prompts = {};
    lobby.players.forEach(p => prompts[p.id] = p.id===fakerId ? 'Fake prompt: make something up' : 'Real prompt: answer truthfully');
    lobby.currentRound = { fakerId, prompts, responses:{}, votes:{} };
    broadcast(ws.lobbyCode, { type:'roundStarted', payload:{ prompts, players:lobby.players.map(p=>({id:p.id,name:p.name})) } });
}

function submitResponse(ws, response) {
    const lobby = lobbies[ws.lobbyCode]; if(!lobby?.currentRound) return;
    lobby.currentRound.responses[ws.id] = response;
    if(Object.keys(lobby.currentRound.responses).length===lobby.players.length) {
        const anonResponses = Object.entries(lobby.currentRound.responses).map(([id,text],i)=>({text,optionId:i}));
        lobby.currentRound.anonMap = Object.fromEntries(Object.keys(lobby.currentRound.responses).map((id,i)=>[i,id]));
        broadcast(ws.lobbyCode,{type:'votingStarted', payload:{responses:anonResponses}});
    }
}

function submitVote(ws, voteForId) {
    const lobby = lobbies[ws.lobbyCode]; if(!lobby?.currentRound) return;
    lobby.currentRound.votes[ws.id] = voteForId;
    if(Object.keys(lobby.currentRound.votes).length===lobby.players.length) revealRound(lobby);
}

function revealRound(lobby) {
    const fakerId = lobby.currentRound.fakerId;
    const votes = lobby.currentRound.votes;

    lobby.players.forEach(p => {
        if(p.id===fakerId) {
            const points = Object.values(votes).filter(v=>v!==fakerId).length;
            p.score += points;
        } else {
            if(votes[p.id]===fakerId) p.score +=1;
        }
    });

    broadcast(lobby.code,{type:'roundReveal',payload:{fakerId,votes,scores:lobby.players.map(p=>({name:p.name,score:p.score}))}});
}

function nextRound(ws) {
    const lobby = lobbies[ws.lobbyCode]; if(!lobby) return;
    lobby.currentRound = null;
    broadcast(ws.lobbyCode,{type:'nextRound'});
}

console.log(`WebSocket server running on port ${PORT}`);
