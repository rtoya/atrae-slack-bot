# Slack Big Emoji Worker

Cloudflare Workers (Hono + TypeScript) で実装した `/bigemoji` スラッシュコマンドのバックエンド（社内用アプリ）。

## 機能

- `/bigemoji` 実行でモーダルを表示
- external_select によるタイプアヘッド絵文字検索
- 選択した絵文字の**画像ファイル**を投稿（URLではなく実際の画像）
- KVによる絵文字リストキャッシュ (12時間)
- 環境変数によるBot Token管理（社内用アプリ）
- Slack署名検証によるセキュリティ

## クイックスタート

### ローカルテスト

ローカル環境でテストする場合は、[LOCAL_TESTING.md](./LOCAL_TESTING.md) を参照してください。

### 本番デプロイ

本番環境にデプロイする場合は、以下のセットアップ手順に従ってください。

## セットアップ

### 1. 必要なツール

- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) がインストールされていること
- Cloudflare アカウント

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. Cloudflare リソースの作成

#### KV Namespace の作成

```bash
# 本番用
wrangler kv namespace create "EMOJI_KV"
# Preview用
wrangler kv namespace create "EMOJI_KV" --preview
```

出力された ID と preview_id を `wrangler.toml` の `kv_namespaces` に設定してください。

### 4. 環境変数の設定

Slack アプリの設定から取得した値を設定します:

```bash
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put SLACK_SIGNING_SECRET
```

### 5. Slack アプリの設定

[Slack API](https://api.slack.com/apps) でアプリを作成し、以下を設定:

#### Slash Commands

- Command: `/bigemoji`
- Request URL: `https://<your-worker-domain>/slack/command`
- Short description: "Pick a custom emoji and post its original image URL"

#### Interactivity & Shortcuts

- Interactivity: On
- Request URL: `https://<your-worker-domain>/slack/interactive`
- Options Load URL: `https://<your-worker-domain>/slack/options`
- Shortcuts:
  - **メッセージショートカット**:
    - Type: On messages
    - Name: `Big Emoji`
    - Short Description: `Post a big emoji image`
    - Callback ID: `bigemoji_shortcut`
  - **グローバルショートカット**:
    - Type: Global
    - Name: `Big Emoji (Global)`
    - Short Description: `Post a big emoji image to any channel`
    - Callback ID: `bigemoji_global`

#### OAuth & Permissions

- Bot Token Scopes:
  - `commands`
  - `chat:write`
  - `emoji:read`
  - `files:write`

#### Event Subscriptions

不要

### 6. Bot Tokenの取得

Slackアプリの管理画面から "OAuth & Permissions" → "Bot User OAuth Token" をコピーして、環境変数に設定してください:

```bash
wrangler secret put SLACK_BOT_TOKEN
# プロンプトでBot Tokenを貼り付け
```

### 6.5. User Tokenの取得（オプション - ユーザーとして投稿する場合）

ユーザーとして投稿したい場合は、User Tokenも設定します:

1. Slack Appの "OAuth & Permissions" で User Token Scopes に以下を追加:
   - `chat:write`
   - `files:write`

2. "Install to Workspace" で再インストール

3. "User OAuth Token" をコピーして環境変数に設定:

```bash
wrangler secret put SLACK_USER_TOKEN
# プロンプトでUser Tokenを貼り付け
```

**注意**: User Tokenを設定すると、すべての投稿がそのユーザー名で行われます。設定しない場合はBotとして投稿されます。

### 7. ビルドとデプロイ

```bash
# ビルド
npm run build

# デプロイ
npm run deploy
```

デプロイ後、Workers のURLが表示されるので、Slack アプリの設定URLを更新してください。

### 8. アプリのインストール

Slackアプリの管理画面から "Install App" → "Install to Workspace" でアプリをワークスペースにインストールしてください。

インストール後、"OAuth & Permissions" ページに表示される "Bot User OAuth Token" をコピーして、環境変数に設定します（手順6参照）。

## 使い方

### 方法1: スラッシュコマンド（チャンネルのみ）

1. Slack チャンネルで `/bigemoji` を実行
2. モーダルが開くので、絵文字を検索して選択（タイプアヘッド検索対応）
3. "Post" ボタンをクリック
4. 選択した絵文字の画像ファイルがチャンネルに投稿される

### 方法2: メッセージショートカット（スレッド対応）

1. 任意のメッセージにカーソルを合わせて「...」メニューをクリック
2. "Big Emoji" を選択
3. モーダルが開くので、絵文字を検索して選択
4. "Post" ボタンをクリック
5. 選択した絵文字の画像ファイルが投稿される
   - チャンネルのメッセージから実行: チャンネルに投稿
   - スレッド内のメッセージから実行: スレッドに返信として投稿

### 方法3: グローバルショートカット（どこからでも実行可能）

1. Slackの稲妻アイコン⚡をクリック（またはCmd+Shift+A / Ctrl+Shift+A）
2. "Big Emoji (Global)" を選択
3. モーダルが開くので、投稿先チャンネルと絵文字を選択
4. "Post" ボタンをクリック
5. 選択したチャンネルに絵文字の画像ファイルが投稿される

**投稿者について:**
- `SLACK_USER_TOKEN` が設定されている場合: ユーザーとして投稿
- `SLACK_USER_TOKEN` が未設定の場合: Botとして投稿

## 開発

```bash
# ローカル開発サーバー起動
npm run dev
```

## ファイル構成

```
.
├── src/
│   ├── index.ts       # メインアプリケーション (Hono)
│   ├── slack.ts       # Slack署名検証
│   ├── slack-api.ts   # Slack API呼び出し
│   └── emoji.ts       # 絵文字管理・キャッシュ
├── schema.sql         # スキーマファイル（社内アプリでは不使用）
├── wrangler.toml      # Wrangler設定
├── tsconfig.json      # TypeScript設定
└── package.json       # パッケージ情報
```

## トラブルシューティング

### `Invalid request signature` エラー

- Signing Secret が正しく設定されているか確認
- タイムスタンプのずれをチェック

### モーダルが開かない

- `trigger_id` が正しく渡されているか
- Bot トークンが環境変数に正しく設定されているか確認
- アプリがワークスペースにインストールされているか確認

### 絵文字候補が表示されない

- `emoji:read` スコープが付与されているか
- Bot トークンが環境変数に正しく設定されているか確認
- KV キャッシュをクリアして再試行

### 画像アップロードが失敗する

- `files:write` スコープが付与されているか確認
- アプリを再インストールして最新のscopeを反映

## ライセンス

MIT
