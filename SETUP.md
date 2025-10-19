# Slack Big Emoji セットアップ手順

このドキュメントでは、Slack Big Emojiアプリを新しいワークスペースにセットアップする手順を説明します。

## 前提条件

- Cloudflareアカウント
- Slackワークスペースの管理者権限
- `wrangler` CLI がインストール済み

## 1. Slackアプリの作成

### 1.1 新しいアプリを作成

1. [Slack API](https://api.slack.com/apps) にアクセス
2. **"Create New App"** をクリック
3. **"From scratch"** を選択
4. App Name: `Big Emoji` (任意)
5. Workspace: セットアップ先のワークスペースを選択
6. **"Create App"** をクリック

### 1.2 Bot Token Scopes の設定

1. 左メニュー → **"OAuth & Permissions"**
2. **"Scopes"** セクションの **"Bot Token Scopes"** に以下を追加:
   - `commands`
   - `chat:write`
   - `emoji:read`
   - `files:write`

### 1.3 Slash Commands の設定

1. 左メニュー → **"Slash Commands"**
2. **"Create New Command"** をクリック
3. 以下を入力:
   - Command: `/bigemoji`
   - Request URL: `https://big-emoji.com/slack/command`
   - Short Description: `Pick a custom emoji and post its image`
   - Usage Hint: (空欄でOK)
4. **"Save"** をクリック

### 1.4 Interactivity & Shortcuts の設定

1. 左メニュー → **"Interactivity & Shortcuts"**
2. **Interactivity** を **ON** にする
3. **Request URL**: `https://big-emoji.com/slack/interactive`
4. **"Select Menus"** セクションの **Options Load URL**: `https://big-emoji.com/slack/options`
5. **"Save Changes"** をクリック

### 1.5 OAuth & Permissions の設定

1. 左メニュー → **"OAuth & Permissions"**
2. **"Redirect URLs"** セクションで **"Add New Redirect URL"** をクリック
3. URL: `https://big-emoji.com/oauth/callback`
4. **"Add"** をクリック
5. **"Save URLs"** をクリック

## 2. 認証情報の取得

### 2.1 基本情報の取得

1. 左メニュー → **"Basic Information"**
2. **"App Credentials"** セクションから以下をコピー:
   - **Client ID**
   - **Client Secret** (Show ボタンをクリック)
   - **Signing Secret** (Show ボタンをクリック)

## 3. Cloudflare Workers の設定

### 3.1 認証情報をシークレットに設定

以下のコマンドを実行して、Slack認証情報をCloudflare Workersのシークレットとして設定します:

```bash
# Client ID を設定
echo "YOUR_CLIENT_ID" | wrangler secret put SLACK_CLIENT_ID

# Client Secret を設定
echo "YOUR_CLIENT_SECRET" | wrangler secret put SLACK_CLIENT_SECRET

# Signing Secret を設定
echo "YOUR_SIGNING_SECRET" | wrangler secret put SLACK_SIGNING_SECRET
```

**注意**: `YOUR_CLIENT_ID` などは、手順2.1で取得した実際の値に置き換えてください。

### 3.2 設定の確認

シークレットが正しく設定されているか確認:

```bash
wrangler secret list
```

以下の3つが表示されればOK:
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`

## 4. アプリのインストール

### 4.1 配布設定の有効化

1. 左メニュー → **"Manage Distribution"**
2. **"Remove Hard Coded Information"** のチェックリストをすべて完了させる
3. **"Activate Public Distribution"** をクリック（公開する場合のみ。ワークスペース内のみで使う場合は不要）

### 4.2 アプリをワークスペースにインストール

**方法1: Manage Distribution から（推奨）**

1. 左メニュー → **"Manage Distribution"**
2. **"Add to Slack"** ボタンをクリック
3. 権限確認画面で **"Allow"** をクリック
4. "Authorization complete. You can close this window." と表示されたら成功

**方法2: OAuth URLから**

以下のURLをブラウザで開く（CLIENT_IDは実際の値に置き換え）:

```
https://slack.com/oauth/v2/authorize?client_id=YOUR_CLIENT_ID&scope=commands,chat:write,emoji:read,files:write&redirect_uri=https://big-emoji.com/oauth/callback
```

### 4.3 インストールの確認

D1データベースにBot Tokenが保存されているか確認:

```bash
wrangler d1 execute bigemoji-db --remote --command="SELECT team_id, team_name, scope FROM installations"
```

Team IDとscopeが表示されればインストール成功です。

## 5. 動作確認

### 5.1 基本動作テスト

1. Slackワークスペースの任意のチャンネルで `/bigemoji` を入力
2. モーダルが表示されることを確認
3. 絵文字を検索・選択
4. **"Post"** ボタンをクリック
5. 絵文字の画像ファイルが投稿されることを確認

### 5.2 検索機能のテスト

1. `/bigemoji` でモーダルを開く
2. 絵文字選択フィールドに文字を入力（例: "dog", "smile"）
3. 入力に応じて絞り込まれた候補が表示されることを確認

## 6. 複数ワークスペースへの対応

既に別のワークスペースで動作している場合、同じWorkerで複数ワークスペースに対応できます。

1. 新しいワークスペース用のSlackアプリを作成（手順1を繰り返す）
2. **認証情報は既存のものを更新せず、そのまま**（各ワークスペースごとにアプリを作成するが、認証情報は共有）
3. 新しいワークスペースでアプリをインストール（手順4.2）

**注意**: 各ワークスペースで異なる認証情報を使いたい場合は、別のWorkerをデプロイする必要があります。

## トラブルシューティング

### インストール時に "OAuth failed" エラー

- Redirect URLが正しく設定されているか確認（`https://big-emoji.com/oauth/callback`）
- Client IDとClient Secretが正しいか確認

### `/bigemoji` が反応しない

- Slash Commandsの Request URLが正しいか確認
- アプリがインストールされているか確認（手順5.3）

### モーダルが表示されない

- Interactivityの設定が正しいか確認
- Signing Secretが正しいか確認

### 絵文字候補が表示されない

- `emoji:read` scopeが付与されているか確認
- Bot Tokenが正しく保存されているか確認（手順4.3）

### 画像アップロードが失敗する

- `files:write` scopeが付与されているか確認
- アプリを再インストールしてscopeを更新

## 参考リンク

- [Slack API Documentation](https://api.slack.com/docs)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)
