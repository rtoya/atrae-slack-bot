# Atrae Slack Bot - 仕様書

## 概要

Atrae Slack Botは、Cloudflare Workers上で動作するSlackアプリケーションです。
勤怠管理機能とBig Emoji投稿機能を提供します。

## アーキテクチャ

### プラットフォーム
- **実行環境**: Cloudflare Workers
- **フレームワーク**: Hono (v4.6.7)
- **言語**: TypeScript
- **デプロイドメイン**: big-emoji.com

### ストレージ
- **EMOJI_KV**: カスタム絵文字リストのキャッシュ
- **FREEE_TOKENS_KV**: freee OAuth トークンの保存
- **TIME_CLOCKS_KV**: 打刻データの保存（ユーザーIDごと）

### 環境変数

| 変数名 | 必須 | デフォルト値 | 説明 |
|--------|------|-------------|------|
| SLACK_BOT_TOKEN | ✓ | - | Slack Bot トークン |
| SLACK_SIGNING_SECRET | ✓ | - | Slack署名検証用シークレット |
| SLACK_USER_TOKEN | - | - | ユーザートークン（オプション） |
| FREEE_CLIENT_ID | ✓ | - | freee OAuth クライアントID |
| FREEE_CLIENT_SECRET | ✓ | - | freee OAuth クライアントシークレット |
| FREEE_REDIRECT_URI | ✓ | - | freee OAuth リダイレクトURI |
| NOTIFICATION_CHANNEL_ID | - | "00_at_wevox_ocean" | 打刻通知先チャンネルID |

---

## 機能仕様

### 1. 勤怠管理機能

#### 1.1 打刻システム

**概要**
- ユーザーが出勤・退勤・休憩入り・休憩戻りを記録できる
- データは常にKVに保存される
- freee認証済みの場合は追加でfreee APIにも送信される
- freee連携は完全にオプショナル

**打刻の種類**
| 種類 | type値 | デフォルトメッセージ |
|------|--------|---------------------|
| 出勤 | clock_in | 出勤しました |
| 退勤 | clock_out | 退勤しました |
| 休憩入り | break_begin | 休憩入りしました |
| 休憩戻り | break_end | 休憩戻りしました |

**データフロー**
1. ユーザーがボタンをクリックまたはコマンドを実行
2. KVに打刻データを保存（キー: `latest:{userId}`）
3. freee認証済みの場合、freee APIにも送信
4. モーダルを表示してメッセージ入力を促す
5. ユーザーがメッセージを入力して投稿
6. 指定チャンネルにユーザーとして投稿

**KVデータ構造**
```typescript
interface TimeClockRecord {
  id: string;              // {userId}-{timestamp}
  userId: string;          // SlackユーザーID
  type: 'clock_in' | 'clock_out' | 'break_begin' | 'break_end';
  datetime: string;        // ISO 8601形式
  baseDate: string;        // YYYY-MM-DD形式
}
```

**KVキー構造**
- `latest:{userId}`: 各ユーザーの最新打刻
- `{userId}:{baseDate}:{recordId}`: 日付別履歴

#### 1.2 Homeタブ

**表示内容**
- **ヘッダー**: "Atrae Slack Bot"
- **ステータス表示**:
  - freee認証済み: ✅ freee連携済み
  - freee未認証: 🕐 勤怠管理（freee未連携）
- **最終打刻情報**: ユーザーの最新打刻（種類と日時）
- **勤怠管理ボタン**: 常に表示
  - 出勤・退勤・休憩入り・休憩戻りボタン
- **freee連携ボタン**: freee未認証時のみ表示
  - "freeeと連携する"ボタン（オプション）
  - 説明: freeeと連携すると打刻データをfreeeにも自動送信
- **その他の機能**: `/bigemoji`コマンドの説明

#### 1.3 スラッシュコマンド

**`/clockin` - 出勤**
- 処理: KVに保存 → freee API（認証済み時） → モーダル表示
- freee未認証でも実行可能

**`/clockout` - 退勤**
- 処理: KVに保存 → freee API（認証済み時） → モーダル表示
- freee未認証でも実行可能

#### 1.4 freee連携

**OAuth フロー**
1. `/freee/auth?user_id={userId}` - 認証開始
2. freee認証画面にリダイレクト
3. `/freee/callback?code={code}&state={userId}` - コールバック
4. トークンを取得してKVに保存（キー: `{userId}`）

**トークン管理**
```typescript
interface FreeeTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;      // Unix timestamp
}
```

**API操作**
- `clockIn()`: 出勤打刻
- `clockOut()`: 退勤打刻
- `breakStart()`: 休憩入り
- `breakEnd()`: 休憩戻り
- `getCompanyId()`: 会社ID取得
- `getValidToken()`: トークン自動更新

---

### 2. Big Emoji機能

#### 2.1 概要
カスタム絵文字を拡大表示して投稿する機能

#### 2.2 起動方法

**スラッシュコマンド**
- `/bigemoji`: モーダルを開いて絵文字を選択

**メッセージショートカット**
- メッセージメニューから起動
- callback_id: `bigemoji_shortcut`
- 選択したメッセージのスレッドに投稿

**グローバルショートカット**
- ライトニングアイコンから起動
- callback_id: `bigemoji_global`
- チャンネル選択が必要

#### 2.3 絵文字選択UI
- `external_select`を使用した動的検索
- 検索クエリに応じてフィルタリング（最大100件）
- KVキャッシュ（12時間）でパフォーマンス向上

#### 2.4 投稿形式
- ユーザー名とアイコンを使用
- 画像ブロックで絵文字URLを表示
- スレッド対応（メッセージショートカットから起動時）

---

## エンドポイント仕様

### `/healthz` [GET]
**説明**: ヘルスチェック
**レスポンス**: `ok`

### `/freee/auth` [GET]
**説明**: freee OAuth認証開始
**パラメータ**:
- `user_id` (required): SlackユーザーID

**処理**: freee認証URLにリダイレクト

### `/freee/callback` [GET]
**説明**: freee OAuth コールバック
**パラメータ**:
- `code` (required): 認証コード
- `state` (required): ユーザーID

**処理**: トークン取得 → KV保存 → 成功メッセージ表示

### `/slack/command` [POST]
**説明**: スラッシュコマンド処理
**認証**: Slack署名検証必須

**サポートコマンド**:
- `/clockin`: 出勤
- `/clockout`: 退勤
- その他: Big Emojiモーダル表示

### `/slack/options` [POST]
**説明**: 絵文字検索（external_select）
**認証**: Slack署名検証必須

**処理**: 検索クエリに基づいて絵文字リストをフィルタリング

### `/slack/interactive` [POST]
**説明**: インタラクティブコンポーネント処理
**認証**: Slack署名検証必須

**処理内容**:
- `block_actions`: Homeタブのボタンクリック
- `message_action`: メッセージショートカット
- `shortcut`: グローバルショートカット
- `view_submission`: モーダル送信
  - `bigemoji_modal`: Big Emoji投稿
  - `bigemoji_modal_global`: Big Emoji投稿（グローバル）
  - `clock_message_modal`: 打刻メッセージ投稿

### `/slack/events` [POST]
**説明**: Slackイベント処理
**認証**: Slack署名検証必須

**サポートイベント**:
- `url_verification`: URL検証チャレンジ
- `app_home_opened`: Homeタブ表示

---

## モジュール仕様

### src/index.ts
**説明**: メインアプリケーションファイル
**責務**: ルーティング、エンドポイント処理、ビジネスロジック統合

### src/slack.ts
**説明**: Slack署名検証
**関数**:
- `verifySlackRequest(req, signingSecret)`: リクエスト署名の検証
  - リプレイアタック防止（5分以内のリクエストのみ有効）
  - HMAC-SHA256による署名検証
  - タイミングセーフな比較

### src/slack-api.ts
**説明**: Slack API呼び出しラッパー
**関数**:
- `slackApi(path, token, body)`: 汎用API呼び出し
  - エラーハンドリング
  - JSONレスポンスパース

### src/emoji.ts
**説明**: カスタム絵文字管理
**関数**:
- `getEmojiList(teamId, kv, botToken, ttlSec)`: 絵文字リスト取得
  - KVキャッシュ（デフォルト12時間）
  - エイリアス解決（1レベル）
- `filterEmojiOptions(list, query, limit)`: 絵文字検索フィルタ

**データ構造**:
```typescript
type EmojiEntry = {
  name: string;
  url: string;
};
```

### src/freee.ts
**説明**: freee API クライアント
**関数**:
- `getAuthorizationUrl(config)`: OAuth認証URL生成
- `exchangeCodeForToken(code, config)`: 認証コードをトークンに交換
- `refreshAccessToken(refreshToken, config)`: トークンリフレッシュ
- `getValidToken(tokens, config)`: 有効なトークン取得（自動更新）
- `clockIn(accessToken, companyId)`: 出勤打刻
- `clockOut(accessToken, companyId)`: 退勤打刻
- `breakStart(accessToken, companyId)`: 休憩入り
- `breakEnd(accessToken, companyId)`: 休憩戻り
- `getLatestTimeClock(accessToken, companyId)`: 最新打刻取得
- `getCompanyId(accessToken)`: 会社ID取得

**データ構造**:
```typescript
interface FreeeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface FreeeTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface TimeClock {
  id: number;
  date: string;
  type: 'clock_in' | 'clock_out' | 'break_begin' | 'break_end';
  datetime: string;
  base_date: string;
}
```

### src/time-clock-kv.ts
**説明**: KVベースの打刻データ管理
**関数**:
- `saveTimeClock(kv, userId, type)`: 打刻データ保存
  - 最新打刻を`latest:{userId}`に保存
  - 履歴を`{userId}:{baseDate}:{recordId}`に保存
- `getLatestTimeClock(kv, userId)`: 最新打刻取得
- `getTimeClocksByDate(kv, userId, baseDate)`: 日付別打刻履歴取得

**データ構造**:
```typescript
interface TimeClockRecord {
  id: string;
  userId: string;
  type: 'clock_in' | 'clock_out' | 'break_begin' | 'break_end';
  datetime: string;
  baseDate: string;
}
```

---

## セキュリティ

### リクエスト検証
- 全てのSlackエンドポイントで署名検証を実施
- リプレイアタック防止（5分のタイムウィンドウ）

### トークン管理
- freee トークンは暗号化されずKVに保存（Cloudflare Workers環境の制約）
- トークンは自動更新（5分前にリフレッシュ）

### データ分離
- 打刻データはユーザーIDごとに完全分離
- KVキーにユーザーIDを含めることでアクセス制御

---

## デプロイ

### ビルド
```bash
npm run build
```

### デプロイ
```bash
npm run deploy
```

### 開発
```bash
npm run dev
```

---

## 制限事項

1. **freee API制限**
   - APIレート制限に従う必要がある
   - トークンの有効期限管理が必要

2. **KVストレージ**
   - 絵文字リストのキャッシュは12時間
   - 大量の打刻履歴による容量制限の可能性

3. **Slack API制限**
   - メッセージ投稿のレート制限
   - モーダルのタイムアウト（3秒以内の応答必須）

4. **Cloudflare Workers制限**
   - CPU時間制限（50ms無料、30秒有料）
   - メモリ制限（128MB）

---

## 今後の改善案

1. **エラーハンドリング強化**
   - より詳細なエラーメッセージ
   - リトライロジックの実装

2. **打刻データ管理**
   - 月次レポート機能
   - CSV エクスポート

3. **UI改善**
   - Homeタブの打刻履歴表示
   - グラフィカルな統計表示

4. **通知機能**
   - 打刻忘れリマインダー
   - 異常な勤務時間の検知

5. **テスト**
   - ユニットテストの追加
   - E2Eテストの実装
