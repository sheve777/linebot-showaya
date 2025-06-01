const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const session = require('./sessionManager');

/* ─── ① 店舗ファイル読み込み ─── */
const persona = fs.readFileSync(
  path.join(__dirname, '..', '..', 'persona.txt'),
  'utf8'
);
const menu = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'menu.json'), 'utf8')
);

const menuIndexLine =
  '▼メニュー早見: ' +
  menu.map(m => `${m.id}:${m.name}(${m.カテゴリ})`).join(', ');

/* ─── ② OpenAI クライアント ─── */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ─── ③ Function Calling 定義 ─── */
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

/* ─── ④ 要約設定 ─── */
const MAX_ROUGH = 1200;
const SUMMARY_MAX = 120;
const rough = txt => Math.round(txt.length * 0.75);

/* ─── ⑤ メイン処理 ─── */
module.exports = async (event, client) => {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const uid   = event.source.userId;
  const input = event.message.text;

  /* 履歴取得＋要約 */
  let history = session.get(uid);
  if (history.reduce((n, m) => n + rough(m.content), 0) > MAX_ROUGH) {
    const sum = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-mini',
      messages: [
        { role: 'system', content: '次の会話を150字以内で要約。ただし店主口調のまま:' },
        ...history.map(({ role, content }) => ({ role, content }))
      ],
      max_tokens: SUMMARY_MAX
    });
    history = [{ role: 'system', content: `要約: ${sum.choices[0].message.content.trim()}` }];
  }

  /* 共通メッセージ */
  const base = [
    { role: 'system', content: persona },
    { role: 'system', content: menuIndexLine },
    ...history,
    { role: 'user', content: input }
  ];

  /* 1st コール */
  const first = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: base,
    tools,
    tool_choice: 'auto',
    temperature: 0.8,
    max_tokens: 512
  });
  const choice = first.choices[0];

  /* ── ツール判定 ── */
  if (choice.finish_reason === 'tool_calls') {
    const call = choice.message.tool_calls?.[0];
    if (!call) return reply('おっと、ちょいと探し物に手間取っちまった！もう一度頼むぜ😅');

    /* lookup_menu */
    if (call.function.name === 'lookup_menu') {
      const { id } = JSON.parse(call.function.arguments || '{}');
      const item   = menu.find(m => m.id === id);
      if (!item) return reply('メニューがうまく見つからねぇ！「串物」みたいにカテゴリで言ってくれたら助かるぜ😊');

      const second = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          ...base,
          choice.message,
          {
            role: 'tool',
            tool_call_id: call.id,
            name: 'lookup_menu',
            content: JSON.stringify(item)
          }
        ],
        temperature: 0.8,
        max_tokens: 512
      });
      return reply(second.choices[0].message.content);
    }

    /* search_menu */
    if (call.function.name === 'search_menu') {
      const { keyword } = JSON.parse(call.function.arguments || '{}');
      const hits = menu
        .filter(m => m.name.includes(keyword) || (m.カテゴリ || '').includes(keyword))
        .slice(0, 3);

      const second = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          ...base,
          choice.message,
          {
            role: 'tool',
            tool_call_id: call.id,
            name: 'search_menu',
            content: JSON.stringify(hits)
          }
        ],
        temperature: 0.8,
        max_tokens: 512
      });
      return reply(second.choices[0].message.content);
    }
  }

  /* 通常応答 */
  return reply(choice.message.content);

  /* ── 共通返信 ── */
  function reply(text) {
    session.push(uid, 'user', input);
    session.push(uid, 'assistant', text);
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }
};
