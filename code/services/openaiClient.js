const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const session = require('./sessionManager');

// ---------- ① 店舗ファイルをロード ----------
const persona = fs.readFileSync(path.join(__dirname, '..', '..', 'persona.txt'), 'utf8');
const menu    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'menu.json'), 'utf8'));

// メニュー ID 一覧だけを 1 行で作る → tokens 激減
const menuIndexLine = '▼メニューID一覧: ' + menu.map(m => `${m.id}:${m.name}`).join(', ');

// ---------- ② OpenAI クライアント ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- ③ Function Calling 定義 ----------
const tools = [{
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
}];

// ---------- ④ 要約パラメータ ----------
const MAX_ROUGH_TOKENS = 1200;     // これを超えたら要約
const SUMMARY_MAX_TOKENS = 120;    // 要約モデルの出力上限

// 粗い token 見積り（日本語: 1 文字 ≒ 0.75token）
const roughTokens = (txt) => Math.round(txt.length * 0.75);

// ---------- ⑤ メイン処理 ----------
module.exports = async (event, client) => {
  // テキスト以外は無視
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const uid   = event.source.userId;
  const input = event.message.text;

  // 履歴取得
  let history = session.get(uid);                 // {role,content,t}
  let rough = history.reduce((n, m) => n + roughTokens(m.content), 0);

  // ---------- 要約ロジック ----------
  if (rough > MAX_ROUGH_TOKENS) {
    const summaryRes = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-mini',
      messages: [
        { role: 'system', content: '次の会話を150字以内で要約。ただし店主口調は残す:' },
        ...history.map(({role,content})=>({role,content}))
      ],
      max_tokens: SUMMARY_MAX_TOKENS
    });
    const summary = summaryRes.choices[0].message.content.trim();
    history = [{ role: 'system', content: `要約: ${summary}` }];
  }

  // ---------- OpenAI 1st call ----------
  const baseMessages = [
    { role: 'system', content: persona },
    { role: 'system', content: menuIndexLine },
    ...history,
    { role: 'user', content: input }
  ];

  const first = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: baseMessages,
    tools,
    tool_choice: 'auto',
    temperature: 0.7,
    max_tokens: 256,
    //response_format: { type: 'json_object' }  // 出力暴走防止
  });
  console.log('[DEBUG] finish_reason:', first.choices[0].finish_reason);
  console.log('[DEBUG] content/head:', (first.choices[0].message.content || '').slice(0, 80));

  const firstChoice = first.choices[0];

  // ---------- Function 呼び出しが来た？ ----------
  if (firstChoice.finish_reason === 'tool_calls') {
    const { id } = JSON.parse(firstChoice.message.tool_calls[0].function.arguments);
    const item   = menu.find(m => m.id === id);

    const second = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        ...baseMessages,
        firstChoice.message,                                    // tool call
        {
          role: 'tool',
          tool_call_id: firstChoice.message.tool_calls[0].id,
          name: 'lookup_menu',
          content: JSON.stringify(item)                         // ← 詳細を返す
        }
      ],
      //console.log('[DEBUG] second content/head:', (second.choices[0].message.content || '').slice(0, 80));
      temperature: 0.7,
      max_tokens: 256
    });
    return reply(second.choices[0].message.content);
  }

  // ---------- 通常返信 ----------
  return reply(firstChoice.message.content);

  // ---------- 共通返信関数 ----------
  function reply(text) {
    // 履歴保存
    session.push(uid, 'user', input);
    session.push(uid, 'assistant', text);
    // LINE 返信
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }
};
