const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
const lobbies = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// You will provide your own prompts later
let sampleTopics = ["Magic Carpet","Time Machine","Invisible Cloak"];

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
    case 'createLobby':
      const code = generateCode();
      lobbies[code] = { 
        code, players: [], currentTopic: null, fakerId: null, turnIndex: 0, 
        round: 1, submittedWords: {}, votes: {}, discussionTime: 30, discussionTimer:null 
      };
      ws.send(JSON.stringify({ type: 'lobbyCreated', payload: { code } }));
      break;

    case 'joinLobby':
      const { lobbyCode, name } = payload;
      const lobby = lobbies[lobbyCode];
      if(!lobby) return ws.send(JSON.stringify({ type:'error', payload:'Lobby not found' }));
      const player = { id: ws.id, name, score:0 };
      lobby.players.push(player);
      ws.lobbyCode = lobbyCode;
      broadcastLobbyUpdate(lobbyCode);
      break;

    case 'startRound':
      startRound(ws);
      break;

    case 'submitWord':
      submitWord(ws, payload.word);
      break;

    case 'submitVote':
      submitVote(ws, payload.voteForId);
      break;

    case 'nextTopic':
      nextTopic(ws);
      break;
  }
}

function broadcastLobbyUpdate(code) {
  const lobby = lobbies[code];
  const msg = JSON.stringify({ type:'lobbyUpdate', payload:{ players:lobby.players.map(p=>({id:p.id,name:p.name})) } });
  lobby.players.forEach(p => {
    const conn = Array.from(wss.clients).find(c => c.id === p.id);
    if(conn) conn.send(msg);
  });
}

function broadcastAll(code, msgType, payload) {
  const lobby = lobbies[code];
  const str = JSON.stringify({ type: msgType, payload });
  lobby.players.forEach(p => {
    const conn = Array.from(wss.clients).find(c => c.id === p.id);
    if(conn) conn.send(str);
  });
}

function startRound(ws) {
  const lobby = lobbies[ws.lobbyCode];
  if(!lobby) return;

  const topic = sampleTopics[Math.floor(Math.random()*sampleTopics.length)];
  lobby.currentTopic = topic;

  const fakerIndex = Math.floor(Math.random()*lobby.players.length);
  lobby.fakerId = lobby.players[fakerIndex].id;
  lobby.turnIndex = 0;
  lobby.submittedWords = {};
  lobby.votes = {};

  // send roles
  lobby.players.forEach(p => {
    const conn = Array.from(wss.clients).find(c => c.id === p.id);
    if(!conn) return;
    if(p.id === lobby.fakerId){
      conn.send(JSON.stringify({ type:'roleAssignment', payload:{ role:'Faker', options:sampleTopics.slice(0,5), hint:'Blend in!' } }));
    } else {
      conn.send(JSON.stringify({ type:'roleAssignment', payload:{ role:'TruthTeller', topic } }));
    }
  });

  broadcastAll(ws.lobbyCode,'roundStarted',{ turnPlayerId: lobby.players[lobby.turnIndex].id });
}

function submitWord(ws, word){
  const lobby = lobbies[ws.lobbyCode];
  if(!lobby) return;
  lobby.submittedWords[ws.id] = word;

  lobby.turnIndex++;
  if(lobby.turnIndex >= lobby.players.length){
    startDiscussion(lobby);
  } else {
    broadcastAll(ws.lobbyCode,'roundStarted',{ turnPlayerId: lobby.players[lobby.turnIndex].id });
  }
}

function startDiscussion(lobby){
  broadcastAll(lobby.code,'discussionStart',{ words:lobby.submittedWords, time:lobby.discussionTime });

  // Countdown timer for discussion
  let timeLeft = lobby.discussionTime;
  lobby.discussionTimer = setInterval(()=>{
    timeLeft--;
    broadcastAll(lobby.code,'discussionTick',{ timeLeft });
    if(timeLeft <= 0){
      clearInterval(lobby.discussionTimer);
      broadcastAll(lobby.code,'startVoting',{ players:lobby.players.map(p=>({id:p.id,name:p.name})) });
    }
  },1000);
}

function submitVote(ws, voteForId){
  const lobby = lobbies[ws.lobbyCode];
  if(!lobby) return;
  lobby.votes[ws.id] = voteForId;

  if(Object.keys(lobby.votes).length === lobby.players.length){
    revealRound(lobby);
  }
}

function revealRound(lobby){
  const fakerId = lobby.fakerId;
  const votes = lobby.votes;
  const fakerCaught = Object.values(votes).filter(v => v===fakerId).length > lobby.players.length/2;

  lobby.players.forEach(p=>{
    if(p.id===fakerId){
      if(!fakerCaught) p.score += 3;
    } else {
      if(fakerCaught) p.score += 2;
    }
  });

  broadcastAll(lobby.code,'roundResults',{
    fakerId,
    votes,
    scores:lobby.players.map(p=>({name:p.name,score:p.score}))
  });
}

function nextTopic(ws){
  const lobby = lobbies[ws.lobbyCode];
  if(!lobby) return;
  startRound(ws);
}

console.log(`WebSocket server running on port ${PORT}`);
