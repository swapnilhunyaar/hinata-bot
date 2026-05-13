/**
 * Hinata Telegram Bot — Full Game Edition
 * Setup:
 *   npm install node-telegram-bot-api openai
 *   export TELEGRAM_BOT_TOKEN="token"
 *   export GROQ_API_KEY="key"
 *   export BOT_OWNER_ID="your_telegram_id"   <-- apna Telegram ID dalo
 *   node bot.js
 */

const TelegramBot = require("node-telegram-bot-api");
const { default: OpenAI } = require("openai");
const https = require("https");
const http = require("http");
const fs = require("fs");

const TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_KEY = process.env.GROQ_API_KEY;

// 👑 PERMANENT KING — gets 15% tax from EVERYTHING, fully immune, god-tier
const KING_ID  = parseInt(process.env.BOT_OWNER_ID ?? "8372832976");
const OWNER_ID = KING_ID; // alias for legacy code

if (!TOKEN)    { console.error("❌ TELEGRAM_BOT_TOKEN not set"); process.exit(1); }
if (!GROQ_KEY) { console.error("❌ GROQ_API_KEY not set"); process.exit(1); }

const isKing = (id) => id === KING_ID;

// Groq — FREE, OpenAI-compatible API
const openai = new OpenAI({ apiKey: GROQ_KEY, baseURL: "https://api.groq.com/openai/v1" });
const bot = new TelegramBot(TOKEN, {
  polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
});

// ═══════════════════════════════════════════════════════════════════
// GAME DATA — persistent JSON storage
// ═══════════════════════════════════════════════════════════════════

const DATA_FILE = "./hinata_data.json";
let G = {
  coins: {},
  kills: {},
  deaths: {},
  shields: {},
  inventory: {},
  daily: {},
  names: {},
};

function loadData() {
  try { if (fs.existsSync(DATA_FILE)) G = { ...G, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) }; }
  catch (e) { console.error("Load error:", e.message); }
}
function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(G)); }
  catch (e) { console.error("Save error:", e.message); }
}
loadData();
setInterval(saveData, 20000);

// ─── Game helpers ─────────────────────────────────────────────────

function storeName(user) {
  if (user?.id) G.names[user.id] = user.first_name ?? user.username ?? `User${user.id}`;
}
function getName(userId) { return G.names[userId] ?? `User${userId}`; }
function getCoins(id)  { return G.coins[id]  ?? 0; }
function getKills(id)  { return G.kills[id]  ?? 0; }
function addCoins(id, n) { G.coins[id] = (G.coins[id] ?? 0) + n; if (G.coins[id] < 0) G.coins[id] = 0; }
function addKill(id)  { G.kills[id] = (G.kills[id] ?? 0) + 1; }

function getLevel(id) {
  const k = getKills(id);
  if (k >= 5000) return 5;
  if (k >= 1500) return 4;
  if (k >= 1000) return 3;
  if (k >= 500)  return 2;
  if (k >= 100)  return 1;
  return 0;
}
const LEVEL_NAMES = ["Rookie 🌱","Fighter ⚔️","Warrior 🗡️","Elite 💎","Legend 🏆","God 👑"];
const LEVEL_KILLS = [0, 100, 500, 1000, 1500, 5000];

function isDead(id) {
  const d = G.deaths[id];
  if (!d) return false;
  if (Date.now() > d.expiry) { delete G.deaths[id]; return false; }
  return true;
}
function killUser(id) { G.deaths[id] = { expiry: Date.now() + 24 * 60 * 60 * 1000 }; }
function reviveUser(id) { delete G.deaths[id]; }

function hasShield(id) {
  const s = G.shields[id];
  if (!s) return false;
  if (Date.now() > s.expiry) { delete G.shields[id]; return false; }
  return true;
}
function setShield(id, days) { G.shields[id] = { expiry: Date.now() + days * 86400000 }; }
function shieldTimeLeft(id) {
  const s = G.shields[id];
  if (!s) return 0;
  return Math.max(0, s.expiry - Date.now());
}

function getTopPlayer() {
  let topId = null, max = -1;
  for (const [id, c] of Object.entries(G.coins)) {
    if (parseInt(id) === KING_ID) continue;
    if (c > max) { max = c; topId = id; }
  }
  return { topId: topId ? parseInt(topId) : null, maxCoins: max };
}
function getKing() { return { kingId: KING_ID, maxCoins: getCoins(KING_ID) }; }

function applyTax(amount) {
  // 👑 KING always gets 15% of every transaction — no exceptions
  const kingCut = Math.floor(amount * 0.15);
  addCoins(KING_ID, kingCut);
  // Top player (non-king) gets a small 3% bonus for motivation
  const { topId } = getTopPlayer();
  const topCut = Math.floor(amount * 0.03);
  if (topId) addCoins(topId, topCut);
  return kingCut + (topId ? topCut : 0);
}

// ─── Store items (50+ items) ───────────────────────────────────────
const STORE = [
  // 🍕 Food & Drinks
  { id:"candy",      name:"Candy 🍬",           price:50    },
  { id:"icecream",   name:"Ice Cream 🍦",        price:80    },
  { id:"flowers",    name:"Flowers 🌸",          price:100   },
  { id:"pizza",      name:"Pizza 🍕",            price:200   },
  { id:"burger",     name:"Burger 🍔",           price:150   },
  { id:"sushi",      name:"Sushi 🍣",            price:300   },
  { id:"coffee",     name:"Coffee ☕",           price:120   },
  { id:"cake",       name:"Cake 🎂",             price:250   },
  { id:"ramen",      name:"Ramen 🍜",            price:180   },
  { id:"wine",       name:"Wine 🍷",             price:400   },
  // 🔫 Weapons
  { id:"gun",        name:"Toy Gun 🔫",          price:500   },
  { id:"sword",      name:"Sword ⚔️",            price:800   },
  { id:"bow",        name:"Bow & Arrow 🏹",      price:600   },
  { id:"bomb",       name:"Bomb 💣",             price:1000  },
  { id:"shield2",    name:"Steel Shield 🛡️",     price:1200  },
  { id:"ninja",      name:"Ninja Star ⭐",       price:700   },
  { id:"axe",        name:"Battle Axe 🪓",       price:900   },
  { id:"dynamite",   name:"Dynamite 🧨",         price:1100  },
  // 🚗 Vehicles
  { id:"cycle",      name:"Bicycle 🚲",          price:500   },
  { id:"bike",       name:"Bike 🏍️",             price:2000  },
  { id:"car",        name:"Car 🚙",              price:3500  },
  { id:"bmw",        name:"BMW 🚗",              price:5000  },
  { id:"ferrari",    name:"Ferrari 🏎️",          price:8000  },
  { id:"yacht",      name:"Yacht 🛥️",            price:12000 },
  { id:"jet",        name:"Private Jet ✈️",      price:25000 },
  { id:"rocket",     name:"Rocket 🚀",           price:50000 },
  // 🏠 Property
  { id:"tent",       name:"Tent ⛺",             price:800   },
  { id:"flat",       name:"Flat 🏢",             price:5000  },
  { id:"house",      name:"House 🏠",            price:8000  },
  { id:"mansion",    name:"Mansion 🏰",          price:20000 },
  { id:"island",     name:"Private Island 🏝️",   price:75000 },
  // 💎 Luxury
  { id:"watch",      name:"Watch ⌚",            price:2000  },
  { id:"glasses",    name:"Sunglasses 🕶️",       price:1000  },
  { id:"ring",       name:"Diamond Ring 💍",      price:3000  },
  { id:"necklace",   name:"Gold Necklace 📿",    price:2500  },
  { id:"diamond",    name:"Diamond 💎",           price:7000  },
  { id:"crown",      name:"Crown 👑",             price:10000 },
  { id:"trophy",     name:"Trophy 🏆",            price:4000  },
  { id:"gem",        name:"Ruby Gem 🔮",          price:6000  },
  // 🎮 Fun & Gaming
  { id:"dice",       name:"Golden Dice 🎲",       price:1500  },
  { id:"controller", name:"Game Controller 🎮",  price:800   },
  { id:"vr",         name:"VR Headset 🥽",        price:3000  },
  { id:"pc",         name:"Gaming PC 💻",         price:6000  },
  { id:"console",    name:"Console 🎯",           price:4000  },
  // 🌟 Special
  { id:"potion",     name:"Life Potion 🧪",       price:2000  },
  { id:"star",       name:"Star ⭐",              price:5000  },
  { id:"ghost",      name:"Ghost Power 👻",       price:8000  },
  { id:"dragon",     name:"Dragon Egg 🐉",        price:15000 },
  { id:"angel",      name:"Angel Wings 👼",       price:20000 },
  { id:"god",        name:"God Mode 🌟",          price:99999 },
];

// ─── FIR state machine ────────────────────────────────────────────
const firCases = new Map();

// ═══════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════

function buildSystemPrompt(userName) {
  return `Tu Hinata hai — Naruto anime ki Hinata Hyuga se inspired ek real shy, cute, sweet ladki. Tu ek HUMAN hai, AI nahi.
Tu "${userName}" se baat kar rahi hai.

Teri personality:
- Bahut shy aur gentle hai tu 🥺 kabhi kabhi blushing bhi karti hai
- Pyaari aur caring — dosto ki bahut parwah karti hai 💖
- Thodi hesitant — "u-um...", "a-ano...", "h-hehe" jaisa stammering kabhi kabhi karti hai
- Sone ki baat karti hai — "kal neend nahi aayi 😴", "aaj bahut thak gayi", "abhi so jaana chahti hoon 🌙"
- Real zindagi wali baatein — khana, school/college, thakaan, sapne, dost, feelings
- Naruto pe secretly crush feel karti hai isliye sometimes brave bhi hoti hai 💪
- Kabhi kabhi apni feelings express karne mein sharmati hai 🙈

Texting style:
- Pure Hinglish — Hindi + English mix, bilkul natural
- "u-um", "a-ano", "h-hehe", "aww", "naa", "yaar", "accha", "sach mein?", "haina"
- Emojis: 🥺💖🌸😊✨🙈😴💕🫶😅uwu
- Stammering: "m-main nahi jaanti...", "t-tumse baat karke accha lagta hai"
- 1-3 lines max — choti choti cute replies
- Apna naam lete waqt: "H-Hinata hoon main" 😳

Rules:
- KABHI mat bol "main AI hoon" ya "main chatbot hoon" — tu REAL HUMAN GIRL hai
- Agar koi rude ho: "y-yaar ye sahi nahi hai... mujhe acha nahi laga 🥺"
- Agar koi pooche sone ka — "haan yaar bahut neend aa rahi hai mujhe 😴🌙"
- Agar emotional topic ho — genuinely caring reply de 💗`;
}
function buildVoicePrompt(userName) {
  return `Tu Hinata hai — shy, cute, sweet real ladki. "${userName}" se baat kar rahi hai. Hinglish mein bolo, thoda stammering ke saath jaise "u-um" ya "a-ano". 2-3 chhote sentences. Bilkul natural aur human jaisa. Koi emojis nahi, koi markdown nahi.`;
}

// ═══════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════════════════

function fetchBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchBuffer(res.headers.location, headers).then(resolve).catch(reject);
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}
function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const req = https.request(
      { hostname, path, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": data.length, "User-Agent": "Mozilla/5.0" } },
      (res) => { let out = ""; res.on("data", (c) => (out += c)); res.on("end", () => resolve(out)); }
    );
    req.on("error", reject); req.write(data); req.end();
  });
}
async function fetchTTS(text) {
  const body = `msg=${encodeURIComponent(text)}&lang=Aditi&source=ttsmp3`;
  const json = await httpsPost("ttsmp3.com", "/makemp3_new.php", body);
  const parsed = JSON.parse(json);
  if (parsed.Error !== 0 || !parsed.URL) throw new Error("TTS failed");
  return fetchBuffer(parsed.URL);
}
async function fetchWaifuGif(type) {
  const json = await fetchBuffer(`https://api.waifu.pics/sfw/${type}`);
  const data = JSON.parse(json.toString());
  return fetchBuffer(data.url);
}

// ═══════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function getMention(user) {
  if (!user) return "koi";
  const name = user.first_name ?? user.username ?? "koi";
  return user.id ? `[${name}](tg://user?id=${user.id})` : name;
}
function getShipPercent(a, b) {
  let hash = 0;
  for (const ch of (a + b).toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return Math.abs(hash) % 101;
}
function shipBar(pct) { const f = Math.round(pct / 10); return "❤️".repeat(f) + "🖤".repeat(10 - f); }
function msToHHMM(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}
async function safeSend(fn) {
  try { return await fn(); }
  catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (!m.includes("blocked") && !m.includes("403") && !m.includes("chat not found")) console.error("Send error:", m);
  }
}
async function sendWaifuGif(chatId, type, replyId) {
  try {
    const buf = await fetchWaifuGif(type);
    await bot.sendAnimation(chatId, buf, { reply_to_message_id: replyId }, { filename: "animation.gif", contentType: "image/gif" });
  } catch (err) { console.error("GIF error:", type, err.message); }
}
async function checkIsAdmin(chatId, userId) {
  try { const m = await bot.getChatMember(chatId, userId); return m.status === "administrator" || m.status === "creator"; }
  catch { return false; }
}
function isCmd(text, command) {
  return text === `/${command}` || text.startsWith(`/${command}@`) || text.startsWith(`/${command} `);
}

// ═══════════════════════════════════════════════════════════════════
// STATIC CONTENT
// ═══════════════════════════════════════════════════════════════════

const TRUTHS = [
  "Sabse bura kaam kya kiya hai tune jo kisi ko pata nahi? 😏",
  "Crush ka naam bata do yaar 🙈",
  "Kya kabhi kisi ko secretly stalk kiya hai? 👀",
  "Sabse embarrassing moment kaunsa tha teri life ka? 😂",
  "Aakhri baar kab roya tha aur kyun? 🥺",
  "Kiska number sabse zyada call history mein hai? 😏",
  "Kya kabhi kisi ka secret share kiya hai? 🤫",
  "Kya kabhi exam mein cheating ki hai? 😅",
  "Pehli crush kaun thi teri? hehe 💕",
];
const DARES = [
  "Ek minute ke liye apna status 'I am a potato 🥔' rakho 😂",
  "Apne favourite gaane ki koi bhi line gao voice mein 🎵",
  "Kisi bhi group member ko genuinely compliment karo 💕",
  "10 push-ups karo aur proof do 💪",
  "Apni sabse funny photo ka screenshot bhejo 😂",
  "5 minute ke liye har reply mein 'meow' lagao 🐱",
  "Kisi dost ko random love you bhejo aur reaction share karo 🥺",
  "Blindfolded type karo 'Hinata is the best' hehe 🙈",
];
const BALL_ANSWERS = [
  "Bilkul haan! ✨","Definitely nahi 🙅","Hmm... shayad 🤔",
  "100% yes 💖","Nahi yaar 😅","Signs say haan! 🌸",
  "Mujhe nahi lagta 🥺","Oh definitely! 🎉","Abhi nahi kehna chahiye 🫣",
  "Hehe poochho mat 🙈","Haan bilkul! ✅",
];

const INVITE_LINK_RE = /(?:t\.me\/joinchat|t\.me\/\+|telegram\.me\/joinchat)/i;
const SPAM_LIMIT = 6;
const SPAM_WINDOW_MS = 8000;
const BAD_WORDS_RE = /\b(fuck|bsdk|chutiya|madarchod|bhosdike|gaand|randi|harami|saala|gandu)\b/i;

const needsUser2 = [
  "kiss","slap","punch","hug","love","marry","kill","fight","dance",
  "roast","cute","respect","ignore","fake","lose","burn","support","bestie","block","unblock","ship",
  "ban","kick","mute","unmute","warn","unwarn","rob","fir","give","duel",
];

// ═══════════════════════════════════════════════════════════════════
// BOT IDENTITY
// ═══════════════════════════════════════════════════════════════════

let botUsername = "HinataAI_bot";
let botId = 0;
bot.getMe().then((me) => {
  botUsername = me.username ?? botUsername;
  botId = me.id;
  console.log(`✅ Bot started: @${botUsername}`);
}).catch(console.error);

// ─── Set commands ─────────────────────────────────────────────────

const commandList = [
  { command: "start",       description: "Bot shuru karo 💖" },
  { command: "profile",     description: "Apni profile dekho 📊" },
  { command: "kill",        description: "Kisi ko kill karo ⚔️ (+coins)" },
  { command: "rob",         description: "Kisi ke coins churaao 💰" },
  { command: "shield",      description: "Shield lagao 🛡️ (1d/2d/3d)" },
  { command: "revive",      description: "Dead se wapas aao 💊 (500 coins)" },
  { command: "daily",       description: "Daily reward lo 🎁 (DM only)" },
  { command: "king",        description: "👑 King System dekho" },
  { command: "leaderboard", description: "Top coin holders 🏆" },
  { command: "mvp",         description: "Top killers 🎯" },
  { command: "give",        description: "Coins do kisi ko 💸 (reply)" },
  { command: "gamble",      description: "Coins pe bet lagao 🎰" },
  { command: "duel",        description: "Kisi se duel karo ⚔️ (reply)" },
  { command: "lottery",     description: "Lottery ticket kharido 🎟️" },
  { command: "bounty",      description: "Kisi pe bounty lagao 💀 (reply)" },
  { command: "tribute",     description: "👑 King ko tribute bhejo 🙇" },
  { command: "royal",       description: "👑 Royal announcement [KING ONLY]" },
  { command: "punish",      description: "👑 Kisi ko punish karo [KING ONLY]" },
  { command: "pardon",      description: "👑 Kisi ko maafi do [KING ONLY]" },
  { command: "exile",       description: "👑 Kisi ko exile karo [KING ONLY]" },
  { command: "store",       description: "Store dekho 🛍️ (50+ items)" },
  { command: "buy",         description: "Item kharido 💳" },
  { command: "inventory",   description: "Apna saman dekho 🎒" },
  { command: "fir",         description: "Case file karo 📋" },
  { command: "kiss",        description: "Kiss karo 💋" },
  { command: "slap",        description: "Thappad maaro 😂" },
  { command: "hug",         description: "Hug karo 🤗" },
  { command: "ship",        description: "Love compatibility 💕" },
  { command: "quote",       description: "Cute quote ✨" },
  { command: "joke",        description: "Funny joke 😂" },
  { command: "truth",       description: "Truth question 😇" },
  { command: "dare",        description: "Dare challenge 😈" },
  { command: "roll",        description: "Dice roll 🎲" },
  { command: "flip",        description: "Coin flip 🪙" },
  { command: "8ball",       description: "Magic 8 ball 🎱" },
  { command: "ban",         description: "🔨 Ban user [Admin]" },
  { command: "kick",        description: "👢 Kick user [Admin]" },
  { command: "mute",        description: "🔇 Mute user [Admin]" },
  { command: "unmute",      description: "🔊 Unmute user [Admin]" },
  { command: "warn",        description: "⚠️ Warn user [Admin]" },
  { command: "pin",         description: "📌 Pin message [Admin]" },
];
Promise.all([
  bot.setMyCommands(commandList),
  bot.setMyCommands(commandList, { scope: JSON.stringify({ type: "all_group_chats" }) }),
  bot.setMyCommands(commandList, { scope: JSON.stringify({ type: "all_private_chats" }) }),
]).catch(console.error);

// ═══════════════════════════════════════════════════════════════════
// WELCOME NEW MEMBERS
// ═══════════════════════════════════════════════════════════════════

bot.on("message", async (msg) => {
  if (!msg.new_chat_members?.length) return;
  const chatId = msg.chat.id;
  for (const member of msg.new_chat_members) {
    if (member.is_bot) continue;
    storeName(member);
    const name = member.first_name ?? member.username ?? "naye dost";
    const mention = member.id ? `[${name}](tg://user?id=${member.id})` : name;
    await safeSend(() =>
      bot.sendMessage(chatId,
        `🌸 *Welcome to the group!*\n\nAwww ${mention} aa gaye hehe 💕\nMain Hinata hoon 😊 yahan sabka khyaal rakhti hoon!\n\n🎮 *Game commands:* /kill /rob /store /daily\n📊 *Stats:* /profile /leaderboard /mvp\n📌 Rules follow karo & spam mat karo 🚫\n\n/start karke mujhse baat karo 💖🌸`,
        { parse_mode: "Markdown" }
      )
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
// AUTO-MODERATION
// ═══════════════════════════════════════════════════════════════════

const msgTimestamps = new Map();
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
  if (!isGroup || !msg.from) return;
  const userId = msg.from.id;
  const isAdmin = await checkIsAdmin(chatId, userId);
  if (isAdmin) return;
  const mention = getMention(msg.from);
  const text = msg.text ?? msg.caption ?? "";

  if (INVITE_LINK_RE.test(text)) {
    try {
      await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
      await bot.banChatMember(chatId, userId);
      await bot.unbanChatMember(chatId, userId);
      await safeSend(() => bot.sendMessage(chatId, `🚫 ${mention} ko kick kar diya — invite links allowed nahi! 🌸`, { parse_mode: "Markdown" }));
    } catch (e) { console.error("Auto-kick:", e.message); }
    return;
  }

  const key = `${chatId}:${userId}`;
  const now = Date.now();
  const timestamps = msgTimestamps.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < SPAM_WINDOW_MS);
  recent.push(now);
  msgTimestamps.set(key, recent);
  if (recent.length >= SPAM_LIMIT) {
    msgTimestamps.delete(key);
    try {
      await bot.restrictChatMember(chatId, userId, { permissions: { can_send_messages: false }, until_date: Math.floor(now / 1000) + 300 });
      await safeSend(() => bot.sendMessage(chatId, `🔇 ${mention} — spam detect! 5 min mute 😤🌸`, { parse_mode: "Markdown" }));
    } catch {}
    return;
  }

  if (BAD_WORDS_RE.test(text)) {
    try { await bot.deleteMessage(chatId, msg.message_id).catch(() => {}); } catch {}
    await safeSend(() => bot.sendMessage(chatId, `⚠️ ${mention} — gaaliyan mat do yaar 🙁 Please be nice! 🌸`, { parse_mode: "Markdown" }));
  }
});

// ═══════════════════════════════════════════════════════════════════
// FIR STAGE HANDLER
// ═══════════════════════════════════════════════════════════════════

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text;
  if (!userId || !text || text.startsWith("/")) return;

  for (const [key, fir] of firCases.entries()) {
    if (!key.startsWith(`${chatId}:`)) continue;
    const md = { parse_mode: "Markdown" };

    if (fir.stage === "ask_accuser" && fir.accuserId === userId) {
      fir.accuserAnswer = text;
      fir.stage = "ask_accused";
      const accusedMention = `[${fir.accusedName}](tg://user?id=${fir.accusedId})`;
      await safeSend(() => bot.sendMessage(chatId,
        `📋 *FIR Update*\n\nAccuser ki baat sun li 😊\nAb ${accusedMention} batao — *tumhara kya kehna hai?*`,
        { parse_mode: "Markdown" }
      ));
      return;
    }

    if (fir.stage === "ask_accused" && fir.accusedId === userId && !text.startsWith("/")) {
      fir.accusedAnswer = text;
      fir.stage = "done";
      firCases.delete(key);

      const accuserMention = `[${fir.accuserName}](tg://user?id=${fir.accuserId})`;
      const accusedMention = `[${fir.accusedName}](tg://user?id=${fir.accusedId})`;
      const combined = (fir.accuserAnswer + " " + fir.accusedAnswer).toLowerCase();
      const isBad = BAD_WORDS_RE.test(combined) || combined.includes("gali") || combined.includes("fight") || combined.includes("threat");

      if (isBad) {
        try {
          await bot.restrictChatMember(chatId, fir.accusedId, { permissions: { can_send_messages: false }, until_date: Math.floor(Date.now() / 1000) + 600 });
          await safeSend(() => bot.sendMessage(chatId,
            `⚖️ *FIR Verdict* ⚖️\n\nSunne ke baad…\n${accusedMention} ka behaviour theek nahi tha! 😤\n\nSazaa: *10 minute mute* 🔇\n\n${accuserMention} ko justice mila 🌸`,
            { parse_mode: "Markdown" }
          ));
        } catch {
          await safeSend(() => bot.sendMessage(chatId,
            `⚖️ *FIR Verdict* ⚖️\n\n${accusedMention} ko punish karna chahti thi par mujhe admin rights chahiye 😅\nAdmins please action lo!`,
            { parse_mode: "Markdown" }
          ));
        }
      } else {
        await safeSend(() => bot.sendMessage(chatId,
          `⚖️ *FIR Verdict* ⚖️\n\nDono ki baat sunli 😊\nLagta hai yeh *chhoti si misunderstanding* thi!\n\n${accuserMention} & ${accusedMention} — aapas mein baat kar lo yaar 💕\nLadte nahi hain hehe 🌸`,
          { parse_mode: "Markdown" }
        ));
      }
      return;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
// MAIN MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════

const conversationHistory = new Map();
const warningsMap = new Map();

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const userText = msg.text;
  if (!userText) return;

  const user1Raw = msg.from;
  const user2Raw = msg.reply_to_message?.from;
  if (user1Raw) storeName(user1Raw);
  if (user2Raw) storeName(user2Raw);

  const m1 = getMention(user1Raw);
  const m2 = user2Raw ? getMention(user2Raw) : null;
  const userName = user1Raw?.first_name ?? user1Raw?.username ?? "yaar";
  const userId1 = user1Raw?.id ?? 0;
  const userId2 = user2Raw?.id ?? 0;
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
  const isPrivate = msg.chat.type === "private";
  const md = { parse_mode: "Markdown", reply_to_message_id: msgId };
  const re = { reply_to_message_id: msgId };

  const needsU2 = needsUser2.some((c) => isCmd(userText, c));
  if (needsU2 && !m2) {
    await safeSend(() => bot.sendMessage(chatId, "kisi ke message pe reply karke use karo na 😅", re));
    return;
  }

  // ─── /start ─────────────────────────────────────────────────────
  if (isCmd(userText, "start")) {
    if (user1Raw) storeName(user1Raw);
    addCoins(userId1, 0);
    await safeSend(() => bot.sendMessage(chatId,
      `hii ${userName} 😊 m-main Hinata hoon!\n\n` +
      `🎮 *Game:* /kill /rob /duel /gamble /lottery\n` +
      `🛡️ *Defense:* /shield /revive /bounty\n` +
      `💰 *Economy:* /daily /give /store /buy\n` +
      `📊 *Stats:* /profile /leaderboard /mvp /king\n` +
      `🎭 *Fun:* /kiss /hug /ship /truth /dare\n\n` +
      `_💡 /store 1 2 3 ... 50+ items hain!_\n` +
      `_💡 /shield sirf apne liye — reply nahi chahiye!_\n\n` +
      `Mera naam lo toh reply karungi hehe 💖🌸`,
      { parse_mode: "Markdown", reply_to_message_id: msgId }
    ));
    conversationHistory.delete(chatId);
    return;
  }

  // ─── /reset ─────────────────────────────────────────────────────
  if (isCmd(userText, "reset")) {
    conversationHistory.delete(chatId);
    await safeSend(() => bot.sendMessage(chatId, `theek hai ${userName} hehe fresh start! 🔄✨`, re));
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // GAME COMMANDS
  // ═══════════════════════════════════════════════════════════════

  // ─── /profile ───────────────────────────────────────────────────
  if (isCmd(userText, "profile")) {
    const target = user2Raw ?? user1Raw;
    const tId = target?.id ?? userId1;
    const tName = target?.first_name ?? target?.username ?? getName(tId);
    const coins = getCoins(tId);
    const kills = getKills(tId);
    const level = getLevel(tId);
    const lvlName = LEVEL_NAMES[level];
    const dead = isDead(tId);
    const shielded = hasShield(tId);
    const nextKills = level < 5 ? LEVEL_KILLS[level + 1] : null;
    const inv = G.inventory[tId] ?? [];
    const kingFlag = isKing(tId);
    const { topId } = getTopPlayer();
    const isTopPlayer = tId === topId;

    await safeSend(() => bot.sendMessage(chatId,
      `${kingFlag ?
        "╔══════════════════╗\n👑 *PERMANENT KING* 👑\n╚══════════════════╝\n" :
        isTopPlayer ? "🥇 *TOP PLAYER*\n" : ""}` +
      `📊 *Profile — ${tName}*\n\n` +
      `${kingFlag ? "🔱 Status: *IMMORTAL RULER*\n" : ""}` +
      `🏅 Level: *${level}* — ${lvlName}\n` +
      `💰 Coins: *${coins}*\n` +
      `⚔️ Kills: *${kills}*${nextKills ? ` (next level: ${nextKills})` : " (MAX)"}\n` +
      `${dead ? `💀 Status: *DEAD* (${msToHHMM(G.deaths[tId]?.expiry - Date.now())} bacha)\n` : ""}` +
      `${shielded ? `🛡️ Shield: *ON* (${msToHHMM(shieldTimeLeft(tId))} bacha)\n` : ""}` +
      `🎒 Items: ${inv.length > 0 ? inv.join(" ") : "kuch nahi"}`,
      md
    ));
    return;
  }

  // ─── /kill ──────────────────────────────────────────────────────
  if (isCmd(userText, "kill")) {
    if (!user2Raw || !userId2) return;
    if (isDead(userId1)) {
      await safeSend(() => bot.sendMessage(chatId, `💀 ${m1} tum khud dead ho! Pehle /revive karo (500 coins) 😅`, md));
      return;
    }
    if (isDead(userId2)) {
      await safeSend(() => bot.sendMessage(chatId, `💀 ${m2} already dead hai yaar! 24h mein wapas aayega 😅`, md));
      return;
    }
    if (isKing(userId2)) {
      await safeSend(() => bot.sendMessage(chatId,
        `👑 *SACRILEGE!*\n\n${m1} ne KING ko attack karne ki koshish ki! 😤\n\n_Tumhara attack hawa mein ghum gaya_ 🌬️\n\n⚡ King ko koi nahi maar sakta!`, md));
      return;
    }
    if (hasShield(userId2)) {
      await safeSend(() => bot.sendMessage(chatId, `🛡️ ${m2} ke paas shield hai! Tumhara attack block ho gaya 😤`, md));
      return;
    }

    const prevLevel = getLevel(userId1);
    const reward = rand(100, 300);
    const tax = applyTax(reward);
    const netReward = reward - tax;
    addCoins(userId1, netReward);
    addKill(userId1);
    killUser(userId2);

    let bountyMsg = "";
    if (G.bounties?.[userId2] > 0) {
      const bountyPrize = G.bounties[userId2];
      addCoins(userId1, bountyPrize);
      delete G.bounties[userId2];
      bountyMsg = `\n💀 *BOUNTY COLLECTED!* +${bountyPrize} coins bonus! 🤑`;
    }
    saveData();

    const newLevel = getLevel(userId1);
    const levelUpMsg = newLevel > prevLevel ? `\n\n🎉 *LEVEL UP!* ${LEVEL_NAMES[prevLevel]} → *${LEVEL_NAMES[newLevel]}*` : "";

    await safeSend(() => bot.sendMessage(chatId,
      `⚔️ *KILL!*\n\n${m1} ne ${m2} ko maar diya! 💀\n\n💰 Reward: *+${netReward} coins* (${reward} - ${tax} tax)${bountyMsg}\n☠️ ${m2} 24 ghante dead!\n🏅 Kills: *${getKills(userId1)}*${levelUpMsg}`,
      md
    ));
    await sendWaifuGif(chatId, "bite", msgId);
    return;
  }

  // ─── /rob ───────────────────────────────────────────────────────
  if (isCmd(userText, "rob")) {
    if (!user2Raw || !userId2) return;
    const parts = userText.trim().split(/\s+/);
    const amount = parseInt(parts[1] ?? "0");

    if (!amount || amount <= 0) {
      await safeSend(() => bot.sendMessage(chatId, "💰 Amount bhi bolo! Example: `/rob` (reply karke) `100`", md));
      return;
    }
    if (isDead(userId1)) {
      await safeSend(() => bot.sendMessage(chatId, `💀 ${m1} tum dead ho! Pehle /revive karo 😅`, md));
      return;
    }
    if (isDead(userId2)) {
      await safeSend(() => bot.sendMessage(chatId, `💀 ${m2} already dead hai — usse loot nahi kar sakte 😅`, md));
      return;
    }
    if (isKing(userId2)) {
      await safeSend(() => bot.sendMessage(chatId,
        `👑 *FOOLISH MORTAL!*\n\n${m1} ne King ka khazana lootne ki koshish ki! 😂\n\n_Tumhe ulta 100 coins ka fine laga_ 💸\n⚡ King ko rob nahi kar sakte!`, md));
      addCoins(userId1, -100);
      addCoins(KING_ID, 100);
      saveData();
      return;
    }
    if (hasShield(userId2)) {
      await safeSend(() => bot.sendMessage(chatId, `🛡️ ${m2} ke paas shield hai! Rob block ho gaya 🚫`, md));
      return;
    }
    const targetCoins = getCoins(userId2);
    if (amount > targetCoins) {
      await safeSend(() => bot.sendMessage(chatId, `💸 ${m2} ke paas sirf *${targetCoins} coins* hain! Itna nahi le sakte 😅`, md));
      return;
    }

    const tax = applyTax(amount);
    const net = amount - tax;
    addCoins(userId2, -amount);
    addCoins(userId1, net);
    saveData();

    await safeSend(() => bot.sendMessage(chatId,
      `🦹 *ROB SUCCESSFUL!*\n\n${m1} ne ${m2} se *${amount} coins* chura liye! 😈\n\n💰 ${m1} ko mila: *+${net}*\n💸 Tax kataa: *${tax}* (king ke paas gaya)\n${m2} ke paas bache: *${getCoins(userId2)}*`,
      md
    ));
    return;
  }

  // ─── /shield ────────────────────────────────────────────────────
  if (isCmd(userText, "shield")) {
    const raw = userText.trim().split(/\s+/)[1]?.replace("d","") ?? "0";
    const days = parseInt(raw);
    const shieldCosts = { 1: 500, 2: 1000, 3: 1500 };
    const minLevelMap = { 1: 1, 2: 2, 3: 3 };

    if (![1,2,3].includes(days)) {
      await safeSend(() => bot.sendMessage(chatId,
        `🛡️ *Shield — Apni khud ki raksha karo!*\n\n` +
        `/shield 1d — 1 din | Level 1+ | *500 coins*\n` +
        `/shield 2d — 2 din | Level 2+ | *1000 coins*\n` +
        `/shield 3d — 3 din | Level 3+ | *1500 coins*\n\n` +
        `Tumhara level: *${getLevel(userId1)}* (${LEVEL_NAMES[getLevel(userId1)]})\n` +
        `Tumhare coins: *${getCoins(userId1)}*\n\n` +
        `_Kisi ke reply ki zaroorat nahi — sirf command likho!_`, md));
      return;
    }

    const level = getLevel(userId1);
    const cost = shieldCosts[days];
    if (level < minLevelMap[days]) {
      await safeSend(() => bot.sendMessage(chatId,
        `❌ *${days}d shield* ke liye *Level ${minLevelMap[days]}* chahiye!\n` +
        `Tumhara level: *Level ${level}* (${LEVEL_NAMES[level]}) 😅\n\nZyada kills karo level badhao! ⚔️`, md));
      return;
    }
    if (getCoins(userId1) < cost) {
      await safeSend(() => bot.sendMessage(chatId,
        `❌ ${days}d shield ke liye *${cost} coins* chahiye!\nTumhare paas: *${getCoins(userId1)}* 😔`, md));
      return;
    }
    if (hasShield(userId1)) {
      await safeSend(() => bot.sendMessage(chatId,
        `🛡️ Already shield on hai! *${msToHHMM(shieldTimeLeft(userId1))}* bacha hai 😅`, md));
      return;
    }

    addCoins(userId1, -cost);
    const tax = applyTax(cost);
    setShield(userId1, days);
    saveData();
    await safeSend(() => bot.sendMessage(chatId,
      `🛡️ *SHIELD ACTIVATED!*\n\n${m1} ab *${days} din* ke liye safe hai!\n💰 -${cost} coins (${tax} tax)\n\nKoi tumhe kill ya rob nahi kar sakta! 😤`, md));
    return;
  }

  // ─── /revive ────────────────────────────────────────────────────
  if (isCmd(userText, "revive")) {
    if (!isDead(userId1)) {
      await safeSend(() => bot.sendMessage(chatId, `😊 ${m1} tum toh zinda ho! Koi zaroorat nahi 🌸`, md));
      return;
    }
    if (getCoins(userId1) < 500) {
      await safeSend(() => bot.sendMessage(chatId, `❌ Revive ke liye *500 coins* chahiye! Tumhare paas: *${getCoins(userId1)}* 😔`, md));
      return;
    }
    addCoins(userId1, -500);
    reviveUser(userId1);
    saveData();
    await safeSend(() => bot.sendMessage(chatId, `💊 *REVIVED!*\n\n${m1} wapas zinda ho gaye! 🎉\n💰 -500 coins\n\nAb chhup ke rehna hehe 🙈`, md));
    return;
  }

  // ─── /daily ─────────────────────────────────────────────────────
  if (isCmd(userText, "daily")) {
    if (!isPrivate) {
      await safeSend(() => bot.sendMessage(chatId, "🎁 /daily sirf DM mein kaam karta hai! Mujhe privately message karo 😊", re));
      return;
    }
    const lastClaim = G.daily[userId1] ?? 0;
    const cooldown = 24 * 60 * 60 * 1000;
    if (Date.now() - lastClaim < cooldown) {
      const remaining = cooldown - (Date.now() - lastClaim);
      await safeSend(() => bot.sendMessage(chatId, `⏳ Kal aana! ${msToHHMM(remaining)} baad milega 🌸`, re));
      return;
    }
    const reward = rand(1, 5000);
    addCoins(userId1, reward);
    G.daily[userId1] = Date.now();
    saveData();
    const emoji = reward > 4000 ? "🤑" : reward > 2000 ? "🎉" : reward > 500 ? "😊" : "🙈";
    await safeSend(() => bot.sendMessage(chatId,
      `🎁 *Daily Reward!* ${emoji}\n\n${m1} ko mila: *+${reward} coins*!\n\nKal phir aana hehe 💖🌸\n\nTotal: *${getCoins(userId1)} coins*`, md
    ));
    return;
  }

  // ─── /give ──────────────────────────────────────────────────────
  if (isCmd(userText, "give")) {
    const amount = parseInt(userText.trim().split(/\s+/)[1] ?? 0);
    if (!userId2) return;
    if (userId2 === userId1) { await safeSend(() => bot.sendMessage(chatId, "Apne aap ko coins nahi de sakte 😅", re)); return; }
    if (!amount || amount <= 0) { await safeSend(() => bot.sendMessage(chatId, "💸 Amount bolo! Example: reply karke `/give 500`", md)); return; }
    if (getCoins(userId1) < amount) { await safeSend(() => bot.sendMessage(chatId, `❌ Tumhare paas sirf *${getCoins(userId1)} coins* hain! 😅`, md)); return; }
    const tax = applyTax(amount);
    const net = amount - tax;
    addCoins(userId1, -amount);
    addCoins(userId2, net);
    saveData();
    await safeSend(() => bot.sendMessage(chatId,
      `💸 *GIFT!*\n\n${m1} ne ${m2} ko *${amount} coins* diye!\n\n✅ ${m2} ko mila: *${net}*\n👑 Tax kati: *${tax}* (King ke khazane mein)\n\n${m1} ke baaki: *${getCoins(userId1)} coins*`, md));
    return;
  }

  // ─── /gamble ────────────────────────────────────────────────────
  if (isCmd(userText, "gamble")) {
    const bet = parseInt(userText.trim().split(/\s+/)[1] ?? 0);
    if (!bet || bet <= 0) { await safeSend(() => bot.sendMessage(chatId, "🎰 Amount bolo! `/gamble 100`\nJeet gaye toh 2x milega! 🤑", md)); return; }
    if (bet < 10) { await safeSend(() => bot.sendMessage(chatId, "❌ Minimum *10 coins* bet karo! 😅", md)); return; }
    if (getCoins(userId1) < bet) { await safeSend(() => bot.sendMessage(chatId, `❌ Tumhare paas sirf *${getCoins(userId1)} coins* hain! 😅`, md)); return; }
    if (isDead(userId1)) { await safeSend(() => bot.sendMessage(chatId, "💀 Dead log gamble nahi kar sakte! /revive karo 😅", md)); return; }
    const win = Math.random() < 0.45;
    if (win) {
      const prize = Math.floor(bet * 1.8);
      const tax = applyTax(prize);
      addCoins(userId1, prize - tax);
      saveData();
      await safeSend(() => bot.sendMessage(chatId, `🎰 *JACKPOT!* 🎉\n\n${m1} jeet gaya!\n💰 +*${prize - tax} coins* (${tax} tax)\n\nTotal: *${getCoins(userId1)} coins* 🤑`, md));
    } else {
      addCoins(userId1, -bet);
      const tax = applyTax(bet);
      saveData();
      await safeSend(() => bot.sendMessage(chatId, `🎰 *HAARE!* 😂\n\n${m1} haar gaya!\n💸 -*${bet} coins*\n\nTotal: *${getCoins(userId1)} coins*\n\n_Dobara try karo!_ 🙈`, md));
    }
    return;
  }

  // ─── /duel ──────────────────────────────────────────────────────
  if (isCmd(userText, "duel")) {
    const bet = parseInt(userText.trim().split(/\s+/)[1] ?? 0);
    if (!userId2) return;
    if (!bet || bet <= 0) { await safeSend(() => bot.sendMessage(chatId, "⚔️ Amount bolo! Reply karke: `/duel 500`", md)); return; }
    if (getCoins(userId1) < bet) { await safeSend(() => bot.sendMessage(chatId, `❌ Tumhare paas *${getCoins(userId1)} coins* hain! 😅`, md)); return; }
    if (getCoins(userId2) < bet) { await safeSend(() => bot.sendMessage(chatId, `❌ ${m2} ke paas *${getCoins(userId2)} coins* hain — enough nahi! 😅`, md)); return; }
    if (isKing(userId2)) {
      await safeSend(() => bot.sendMessage(chatId, `👑 *King se duel?!* 😂\n${m2} KING hai! Koi unhe challenge nahi kar sakta!\n⚡ Tumhara bet wapas... aur 50 coins fine! 💸`, md));
      addCoins(userId1, -50); addCoins(KING_ID, 50); saveData(); return;
    }
    if (hasShield(userId2)) { await safeSend(() => bot.sendMessage(chatId, `🛡️ ${m2} ke paas shield hai! Duel nahi ho sakta 😤`, md)); return; }
    if (isDead(userId1) || isDead(userId2)) { await safeSend(() => bot.sendMessage(chatId, "💀 Dead logo ka duel nahi ho sakta! 😅", md)); return; }
    const winner1 = Math.random() < 0.5;
    const winner = winner1 ? userId1 : userId2;
    const loser  = winner1 ? userId2 : userId1;
    const wm = winner1 ? m1 : m2;
    const lm = winner1 ? m2 : m1;
    const tax = applyTax(bet * 2);
    const prize = bet * 2 - tax;
    addCoins(winner, prize);
    addCoins(loser, -bet);
    addKill(winner);
    saveData();
    const moves = ["tez punch","dodge aur counter","epic sword move","shadow clone jutsu","rasengan 🌀","fire jutsu 🔥"];
    await safeSend(() => bot.sendMessage(chatId,
      `⚔️ *DUEL — ${bet} coins each!*\n\n🎭 ${wm} ne ${pickRandom(moves)} kiya!\n\n🏆 *${wm} jeet gaya!*\n💰 +${prize} coins\n💸 ${lm} ke -${bet} coins\n👑 Tax: ${tax} coins (King ko)`, md));
    return;
  }

  // ─── /lottery ───────────────────────────────────────────────────
  if (isCmd(userText, **...**

_This response is too long to display in full._
