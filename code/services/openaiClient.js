const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const session = require('./sessionManager');

/* ---------- ① 店舗ファイル読み込み ---------- */
const persona = fs.readFileSync(path.join(__dirname, '..', '..', 'persona.txt'), 'utf8');
const menu    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'menu.json'), 'utf8'));

// メニュー早見 1 行（id:name(カテゴリ)）
const menuIndexLine =
  '▼メニュー早見: ' +
  menu.map(m => `${m.id}:${m.name}(${m.カテゴリ})`).join(', ');

/* ---------- ② OpenAI クライアント ---------- */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------- ③ Function Calling 定義 ---------- */
const tools = [
  {
    type: 'function',
    function: {
      name: 'lookup_menu',
      description: 'メニューIDを渡すと詳細(名前・価格・説明)を返す',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_menu',
      description: 'キーワードでメニューを最大3件検索する',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string' } },
        required: ['keyword']
      }
    }
  }
];

/* ---------- ④ 要約設定 ---------- */
const MAX_ROUGH_TOKENS   = 1200;
const SUMMARY_MAX_TOKENS = 120;
const roughTokens = txt => Math.round(txt.length * 0.75);

/* ---------- ⑤ メイン処理 ---------- */
module.exports = async (event, client) => {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const uid   = event.source.userId;
  const input = event.message.text;

  /* --- 履歴取得 & 要約 --- */
  let history = session.get(uid);
  let rough   = history.reduce((n, m) => n + roughTokens(m.content), 0);

  if (rough > MAX_ROUGH_TOKENS) {
    const sum = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-mini',
      messages: [
        { role: 'system', content: '次の会話を150字以内で要約。ただし店主口調は残す:' },
        ...history.map(({ role, content }) => ({ role, content }))
      ],
      max_tokens: SUMMARY_MAX_TOKENS
    });
    history = [{ role: 'system', content: `要約: ${sum.choices[0].message.content.trim()}` }];
  }

  /* --- 1st call --- */
  const baseMessages = [
    { role: 'system', content: persona },
    { role: 'system', content: menuIndexLine },
    ...history,
    { role: 'user', content: input }
  ];

  const first = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: baseMessages,
    tools,
    tool_choice: 'auto',
    temperature: 0.8,
    max_tokens: 256
  });

  const choice = first.choices[0];

  /* --- ツール呼び出し判定 --- */
  if (choice.finish_reason === 'tool_calls') {
    const call = choice.message.tool_calls?.[0];
    if (!call) return reply('すまん！ ちょっと出遅れちまった！もう一度聞かせてくれ😅');

    /* =====  lookup_menu  ===== */
    if (call.function.name === 'lookup_menu') {
      const { id } = JSON.parse(call.function.arguments || '{}');
      const item   = menu.find(m => m.id === id);

      if (!item) {
        return reply('メニューをうまく見つけられなかったみたいだ！「串物」とかカテゴリで教えてくれると助かるぜ😊');
      }

      const second = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          ...baseMessages,
          choice.message,
          {
            role: 'tool',
            tool_call_id: call.id,
            name: 'lookup_menu',
            content: JSON.stringify(item)
          }
        ],
        temperature: 0.8,
        max_tokens: 256
      });

      return reply(second.choices[0].message.content);
    }

    /* =====  search_menu  ===== */
    if (call.function.name === 'search_menu') {
      const { keyword } = JSON.parse(call.function.arguments || '{}');
      const hits = menu
        .filter(m =>
          m.name.includes(keyword) ||
          (m.カテゴリ || '').includes(keyword)
        )
        .slice(0, 3);

      const second = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          ...baseMessages,
          choice.message,
          {
            role: 'tool',
            tool_call_id: call.id,
            name: 'search_menu',
            content: JSON.stringify(hits)
          }
        ],
        temperature: 0.8,
        max_tokens: 256
      });

      return reply(second.choices[0].message.content);
    }
  }

  /* --- 通常返信 --- */
  return reply(choice.message.content);

  /* ---------- 共通返信 ---------- */
  function reply(text) {
    session.push(uid, 'user', input);
    session.push(uid, 'assistant', text);
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }
};
