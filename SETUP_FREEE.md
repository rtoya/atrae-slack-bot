# freee勤怠管理機能のセットアップガイド

## 概要
このガイドでは、Slackボットにfreee勤怠管理機能を追加するためのセットアップ手順を説明します。

## 1. freee APIアプリケーションの作成

1. [freee開発者ページ](https://developer.freee.co.jp/)にアクセス
2. 「アプリケーションの新規作成」をクリック
3. 以下の情報を入力:
   - アプリケーション名: `atrae-slack-bot`
   - リダイレクトURI: `https://your-domain.com/freee/callback`
   - スコープ: `write` (勤怠情報の書き込みに必要)
4. Client IDとClient Secretをメモ

## 2. KVネームスペースの作成

freeeのトークンを保存するためのKVネームスペースを作成します:

```bash
# 本番環境用
wrangler kv:namespace create "FREEE_TOKENS_KV"

# プレビュー環境用
wrangler kv:namespace create "FREEE_TOKENS_KV" --preview
```

出力されたIDを `wrangler.toml` の該当箇所に設定してください。

## 3. 環境変数の設定

以下のシークレットを設定します:

```bash
# freee Client ID
wrangler secret put FREEE_CLIENT_ID

# freee Client Secret
wrangler secret put FREEE_CLIENT_SECRET

# freee Redirect URI (例: https://big-emoji.com/freee/callback)
wrangler secret put FREEE_REDIRECT_URI
```

## 4. Slackアプリの設定

### スラッシュコマンドの追加

Slack App管理画面で以下のスラッシュコマンドを追加:

1. `/clockin`
   - Request URL: `https://your-domain.com/slack/command`
   - Short Description: `freeeに出勤を記録`
   - Usage Hint: (空欄)

2. `/clockout`
   - Request URL: `https://your-domain.com/slack/command`
   - Short Description: `freeeに退勤を記録`
   - Usage Hint: (空欄)

### 権限の確認

OAuth & Permissions で以下のスコープが有効になっていることを確認:
- `chat:write` (メッセージ投稿用)
- `commands` (スラッシュコマンド用)

## 5. デプロイ

```bash
npm run build
wrangler deploy
```

## 使い方

### 初回使用時

1. Slackで `/clockin` または `/clockout` を実行
2. 「freeeの認証が必要です」というメッセージが表示される
3. 表示されたURLをクリックしてfreee OAuth認証を完了
4. 認証完了後、再度コマンドを実行

### 出勤記録

```
/clockin
```

- freeeに打刻
- 指定したチャンネルに「@ユーザー名 が出勤しました」と投稿

### 退勤記録

```
/clockout
```

- freeeに打刻
- 指定したチャンネルに「@ユーザー名 が退勤しました」と投稿

## トラブルシューティング

### 認証エラー

- freee Client IDとClient Secretが正しく設定されているか確認
- Redirect URIがfreeeアプリ設定と一致しているか確認

### トークン期限切れ

- トークンは自動的に更新されますが、更新に失敗した場合は再認証が必要です
- エラーメッセージに従って認証URLから再度認証してください

### 打刻エラー

- freeeアカウントに勤怠管理権限があるか確認
- 会社の勤怠設定で打刻が有効になっているか確認

## 技術詳細

### ファイル構成

- `src/freee.ts`: freee API クライアント
- `src/index.ts`: スラッシュコマンドハンドラー (src/index.ts:93-181)

### OAuth フロー

1. ユーザーが `/clockin` または `/clockout` を実行
2. トークンが存在しない場合、認証URLを提示 (src/index.ts:99-104, 145-149)
3. ユーザーがfreeeで認証を完了
4. コールバックでトークンを取得しKVに保存 (src/index.ts:65-67)
5. 次回以降は保存されたトークンを使用

### トークン管理

- アクセストークンは期限切れ前に自動更新
- リフレッシュトークンでアクセストークンを更新 (src/freee.ts:97-113)
- 更新後のトークンはKVに保存 (src/index.ts:109-110, 154-155)
