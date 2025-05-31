require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const lineWebhook = require('./routes/lineWebhook');

const app = express();

// LINE チャネル設定（.env から読み取り）
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// Webhook エンドポイント
app.post('/webhook',
  line.middleware(config),                // 署名検証
  lineWebhook(new line.Client(config))    // ルータに Client を渡す
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
