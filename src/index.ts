import { Hono } from 'hono';
import { verifySlackRequest } from './slack';
import { slackApi } from './slack-api';
import { getEmojiList, filterEmojiOptions } from './emoji';
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  getValidToken,
  clockIn,
  clockOut,
  breakStart,
  breakEnd,
  getCompanyId,
  getLatestTimeClock,
  type FreeeConfig,
  type FreeeTokens,
  type TimeClock
} from './freee';
import {
  saveTimeClock as saveTimeClockKV,
  getLatestTimeClock as getLatestTimeClockKV,
  type TimeClockRecord
} from './time-clock-kv';

type Bindings = {
  EMOJI_KV: KVNamespace;
  FREEE_TOKENS_KV: KVNamespace;
  TIME_CLOCKS_KV: KVNamespace;
  SLACK_BOT_TOKEN: string;
  SLACK_USER_TOKEN?: string;
  SLACK_SIGNING_SECRET: string;
  FREEE_CLIENT_ID: string;
  FREEE_CLIENT_SECRET: string;
  FREEE_REDIRECT_URI: string;
  NOTIFICATION_CHANNEL_ID?: string; // Default notification channel
};

const app = new Hono<{ Bindings: Bindings }>();

// Helper function to publish Home tab
async function publishHomeTab(userId: string, env: Bindings) {
  const tokensJson = await env.FREEE_TOKENS_KV.get(userId);
  const isFreeeAuthenticated = !!tokensJson;

  const blocks: any[] = [];

  // ========== ヘッダーセクション ==========
  blocks.push(
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Atrae Slack Bot'
      }
    }
  );

  // ========== 勤怠管理セクション ==========
  blocks.push(
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📊 勤怠管理*'
      }
    }
  );

  // 最終打刻情報表示
  try {
    const latestClock = await getLatestTimeClockKV(env.TIME_CLOCKS_KV, userId);

    if (latestClock) {
      const typeMap = {
        'clock_in': '出勤',
        'clock_out': '退勤',
        'break_begin': '休憩入り',
        'break_end': '休憩戻り'
      };
      const typeName = typeMap[latestClock.type] || latestClock.type;

      const datetime = new Date(latestClock.datetime);
      const jstTime = datetime.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `最終打刻: *${typeName}* (${jstTime})`
        }
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '最終打刻: _打刻なし_'
        }
      });
    }
  } catch (error) {
    console.error('Failed to get latest time clock:', error);
  }

  // 勤怠管理ボタン
  blocks.push(
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: ':house: リモート出勤'
          },
          style: 'primary',
          action_id: 'clock_in_remote_button'
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: ':office: オフィス出勤'
          },
          style: 'primary',
          action_id: 'clock_in_office_button'
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: ':city_sunset: 退勤'
          },
          action_id: 'clock_out_button'
        }
      ]
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: ':soon: 休憩入り'
          },
          action_id: 'break_start_button'
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: ':back: 休憩戻り'
          },
          action_id: 'break_end_button'
        }
      ]
    }
  );

  // ========== freee連携セクション ==========
  blocks.push(
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: isFreeeAuthenticated
          ? '*🔗 freee連携 (実装中...)*\nステータス: ✅ 連携済み'
          : '*🔗 freee連携 (実装中...)*\nステータス: ⚪️ 未連携'
      }
    }
  );

  if (!isFreeeAuthenticated) {
    const authUrl = `${env.FREEE_REDIRECT_URI.replace('/freee/callback', '/freee/auth')}?user_id=${userId}`;
    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'freeeと連携すると、打刻データをfreeeにも自動送信できます。'
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'freeeと連携する'
            },
            url: authUrl
          }
        ]
      }
    );
  }

  // ========== その他操作セクション ==========
  blocks.push(
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*⚙️ その他操作*'
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔄 ページ更新'
          },
          action_id: 'reload_home_button'
        }
      ]
    }
  );

  // ========== その他機能セクション ==========
  blocks.push(
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*✨ その他機能*\n• `/bigemoji` - Big Emojiを投稿'
      }
    }
  );

  await slackApi('views.publish', env.SLACK_BOT_TOKEN, {
    user_id: userId,
    view: {
      type: 'home',
      blocks: blocks
    }
  });
}

// Health check endpoint
app.get('/healthz', (c) => c.text('ok'));

// --- Freee OAuth Flow ---
app.get('/freee/auth', (c) => {
  const userId = c.req.query('user_id');
  if (!userId) {
    return c.text('Missing user_id parameter', 400);
  }

  const config: FreeeConfig = {
    clientId: c.env.FREEE_CLIENT_ID,
    clientSecret: c.env.FREEE_CLIENT_SECRET,
    redirectUri: c.env.FREEE_REDIRECT_URI
  };

  const authUrl = getAuthorizationUrl(config);
  const stateParam = `&state=${userId}`;

  return c.redirect(authUrl + stateParam);
});

app.get('/freee/callback', async (c) => {
  const code = c.req.query('code');
  const userId = c.req.query('state');

  if (!code || !userId) {
    return c.text('Missing code or state parameter', 400);
  }

  const config: FreeeConfig = {
    clientId: c.env.FREEE_CLIENT_ID,
    clientSecret: c.env.FREEE_CLIENT_SECRET,
    redirectUri: c.env.FREEE_REDIRECT_URI
  };

  try {
    const tokens = await exchangeCodeForToken(code, config);
    await c.env.FREEE_TOKENS_KV.put(userId, JSON.stringify(tokens));

    return c.text('Authentication successful! You can now use /clockin and /clockout commands.');
  } catch (error) {
    console.error('OAuth callback error:', error);
    return c.text('Authentication failed. Please try again.', 500);
  }
});

// --- Slash Command ---
app.post('/slack/command', async (c) => {
  if (!(await verifySlackRequest(c.req.raw, c.env.SLACK_SIGNING_SECRET))) {
    return c.text('Invalid request signature', 401);
  }

  const form = await c.req.formData();
  const command = String(form.get('command') ?? '');
  const user_id = String(form.get('user_id') ?? '');
  const channel_id = String(form.get('channel_id') ?? '');
  const trigger_id = String(form.get('trigger_id') ?? '');
  const thread_ts = String(form.get('thread_ts') ?? '');

  // Handle /clockin command
  if (command === '/clockin') {
    try {
      // Open modal to select remote or office
      await slackApi('views.open', c.env.SLACK_BOT_TOKEN, {
        trigger_id: trigger_id,
        view: {
          type: 'modal',
          callback_id: 'clock_in_select_modal',
          title: { type: 'plain_text', text: '出勤' },
          submit: { type: 'plain_text', text: '次へ' },
          close: { type: 'plain_text', text: 'キャンセル' },
          blocks: [
            {
              type: 'input',
              block_id: 'location_select',
              label: { type: 'plain_text', text: '勤務場所' },
              element: {
                type: 'radio_buttons',
                action_id: 'location',
                initial_option: {
                  text: { type: 'plain_text', text: 'リモート' },
                  value: 'remote'
                },
                options: [
                  {
                    text: { type: 'plain_text', text: 'リモート' },
                    value: 'remote'
                  },
                  {
                    text: { type: 'plain_text', text: 'オフィス' },
                    value: 'office'
                  }
                ]
              }
            }
          ]
        }
      });

      return c.text(''); // Empty 200 response
    } catch (error) {
      console.error('Clock in error:', error);
      return c.json({
        response_type: 'ephemeral',
        text: `エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // Handle /clockout command
  if (command === '/clockout') {
    try {
      // Open modal for daily report input (data will be saved in modal submission)
      const metadata = JSON.stringify({ clock_type: 'clock_out' });
      await slackApi('views.open', c.env.SLACK_BOT_TOKEN, {
        trigger_id: trigger_id,
        view: {
          type: 'modal',
          callback_id: 'clock_message_modal',
          private_metadata: metadata,
          title: { type: 'plain_text', text: '退勤' },
          submit: { type: 'plain_text', text: '投稿' },
          close: { type: 'plain_text', text: 'キャンセル' },
          blocks: [
            {
              type: 'input',
              block_id: 'message_input',
              label: { type: 'plain_text', text: '日報' },
              element: {
                type: 'plain_text_input',
                action_id: 'message',
                multiline: true,
                min_length: 1,
                initial_value: `*今日やったこと*\n- \n\n*明日やること*\n- \n\n*ひとこと*\n- `,
                placeholder: { type: 'plain_text', text: '日報を入力してください' }
              }
            }
          ]
        }
      });

      return c.text(''); // Empty 200 response
    } catch (error) {
      console.error('Clock out error:', error);
      return c.json({
        response_type: 'ephemeral',
        text: `エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // Default: bigemoji command
  // Store channel and thread_ts in private_metadata
  const metadata = JSON.stringify({ channel_id, thread_ts });

  // Open modal with external_select
  await slackApi('views.open', c.env.SLACK_BOT_TOKEN, {
    trigger_id,
    view: {
      type: 'modal',
      callback_id: 'bigemoji_modal',
      private_metadata: metadata, // Store channel and thread for later
      title: { type: 'plain_text', text: 'Big Emoji' },
      submit: { type: 'plain_text', text: 'Post' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'emoji_pick',
          label: { type: 'plain_text', text: 'Pick an emoji' },
          element: {
            type: 'external_select',
            action_id: 'emoji_select',
            min_query_length: 0,
            placeholder: { type: 'plain_text', text: 'Search custom emoji' }
          }
        }
      ]
    }
  });

  return c.text(''); // Empty 200 response
});

// --- Options (external_select) ---
app.post('/slack/options', async (c) => {
  if (!(await verifySlackRequest(c.req.raw, c.env.SLACK_SIGNING_SECRET))) {
    return c.text('Invalid request signature', 401);
  }

  const payload = JSON.parse((await c.req.formData()).get('payload') as string);
  const team_id = payload.team.id as string;
  const query = (payload.value as string) ?? '';

  const list = await getEmojiList(team_id, c.env.EMOJI_KV, c.env.SLACK_BOT_TOKEN);
  const options = filterEmojiOptions(list, query, 100);

  return c.json({ options });
});

// --- Interactive (shortcuts and submit) ---
app.post('/slack/interactive', async (c) => {
  if (!(await verifySlackRequest(c.req.raw, c.env.SLACK_SIGNING_SECRET))) {
    return c.text('Invalid request signature', 401);
  }

  const payload = JSON.parse((await c.req.formData()).get('payload') as string);

  // Handle block_actions (button clicks from Home tab)
  if (payload.type === 'block_actions') {
    const action = payload.actions[0];
    const userId = payload.user.id;
    const actionId = action.action_id;
    const triggerId = payload.trigger_id;

    // Handle reload button
    if (actionId === 'reload_home_button') {
      await publishHomeTab(userId, c.env);
      return c.json({});
    }

    try {
      let defaultMessage = '';
      let clockType: 'clock_in' | 'clock_out' | 'break_begin' | 'break_end' | null = null;
      let modalTitle = '';
      let requireModal = true;
      let location = '';

      if (actionId === 'clock_in_remote_button') {
        clockType = 'clock_in';
        location = 'remote';
        defaultMessage = '';
        modalTitle = 'リモート出勤';
      } else if (actionId === 'clock_in_office_button') {
        clockType = 'clock_in';
        location = 'office';
        defaultMessage = '';
        modalTitle = 'オフィス出勤';
      } else if (actionId === 'clock_out_button') {
        clockType = 'clock_out';
        defaultMessage = `*今日やったこと*\n- \n\n*明日やること*\n- \n\n*ひとこと*\n- `;
        modalTitle = '退勤';
      } else if (actionId === 'break_start_button') {
        clockType = 'break_begin';
        defaultMessage = '休憩入りしました';
        modalTitle = '休憩入り';
        requireModal = false;
      } else if (actionId === 'break_end_button') {
        clockType = 'break_end';
        defaultMessage = '休憩戻りしました';
        modalTitle = '休憩戻り';
        requireModal = false;
      }

      if (!clockType) {
        return c.json({});
      }

      // For break start/end, process directly without modal
      if (!requireModal) {
        // Process in background (save to KV only, no Slack post)
        c.executionCtx.waitUntil((async () => {
          try {
            // Save to KV
            await saveTimeClockKV(c.env.TIME_CLOCKS_KV, userId, clockType);
            console.log('Saved to KV:', userId, clockType);
          } catch (error) {
            console.error('KV save error:', error);
          }
        })());

        return c.json({});
      }

      // For clock in/out, open modal immediately (save data later in modal submission)
      const metadata = JSON.stringify({ clock_type: clockType, location });

      // For clock_out, use multiline input for daily report
      const inputElement = clockType === 'clock_out' ? {
        type: 'plain_text_input',
        action_id: 'message',
        multiline: true,
        min_length: 1,
        initial_value: defaultMessage,
        placeholder: { type: 'plain_text', text: '日報を入力してください' }
      } : {
        type: 'plain_text_input',
        action_id: 'message',
        initial_value: defaultMessage,
        placeholder: { type: 'plain_text', text: 'メッセージを入力してください' }
      };

      await slackApi('views.open', c.env.SLACK_BOT_TOKEN, {
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'clock_message_modal',
          private_metadata: metadata,
          title: { type: 'plain_text', text: modalTitle },
          submit: { type: 'plain_text', text: '投稿' },
          close: { type: 'plain_text', text: 'キャンセル' },
          blocks: [
            {
              type: 'input',
              block_id: 'message_input',
              label: { type: 'plain_text', text: clockType === 'clock_out' ? '日報' : 'メッセージ' },
              element: inputElement
            }
          ]
        }
      });

      return c.json({});
    } catch (error) {
      console.error('Button action error:', error);
      return c.json({
        response_action: 'errors',
        errors: { message: `エラーが発生しました: ${error instanceof Error ? error.message : String(error)}` }
      });
    }
  }

  // Handle message shortcut (from message menu)
  if (payload.type === 'message_action' && payload.callback_id === 'bigemoji_shortcut') {
    const trigger_id = payload.trigger_id as string;
    const channel_id = payload.channel.id as string;
    const message_ts = payload.message.thread_ts || payload.message.ts || '';

    // Store channel and thread_ts in private_metadata
    const metadata = JSON.stringify({
      channel_id,
      thread_ts: message_ts
    });

    // Open modal with external_select
    await slackApi('views.open', c.env.SLACK_BOT_TOKEN, {
      trigger_id,
      view: {
        type: 'modal',
        callback_id: 'bigemoji_modal',
        private_metadata: metadata,
        title: { type: 'plain_text', text: 'Big Emoji' },
        submit: { type: 'plain_text', text: 'Post' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'emoji_pick',
            label: { type: 'plain_text', text: 'Pick an emoji' },
            element: {
              type: 'external_select',
              action_id: 'emoji_select',
              min_query_length: 0,
              placeholder: { type: 'plain_text', text: 'Search custom emoji' }
            }
          }
        ]
      }
    });

    return c.json({});
  }

  // Handle global shortcut (from lightning icon)
  if (payload.type === 'shortcut' && payload.callback_id === 'bigemoji_global') {
    const trigger_id = payload.trigger_id as string;

    // For global shortcuts, ask user to select channel
    await slackApi('views.open', c.env.SLACK_BOT_TOKEN, {
      trigger_id,
      view: {
        type: 'modal',
        callback_id: 'bigemoji_modal_global',
        title: { type: 'plain_text', text: 'Big Emoji' },
        submit: { type: 'plain_text', text: 'Post' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'channel_select',
            label: { type: 'plain_text', text: 'Select channel' },
            element: {
              type: 'conversations_select',
              action_id: 'channel',
              placeholder: { type: 'plain_text', text: 'Choose a channel' }
            }
          },
          {
            type: 'input',
            block_id: 'emoji_pick',
            label: { type: 'plain_text', text: 'Pick an emoji' },
            element: {
              type: 'external_select',
              action_id: 'emoji_select',
              min_query_length: 0,
              placeholder: { type: 'plain_text', text: 'Search custom emoji' }
            }
          }
        ]
      }
    });

    return c.json({});
  }

  // Handle modal submission
  if (payload.type === 'view_submission' && payload.view.callback_id === 'bigemoji_modal') {
    const team_id = payload.team.id as string;
    const user_id = payload.user?.id as string;
    const metadata = JSON.parse(payload.view.private_metadata as string);
    const channel = metadata.channel_id as string;
    const thread_ts = metadata.thread_ts as string;
    const selection = payload.view.state.values['emoji_pick']['emoji_select']
      .selected_option?.value as string;

    if (!selection) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Please select an emoji' }
      });
    }

    // Get user info for username and icon
    const userInfoRes = await fetch(`https://slack.com/api/users.info?user=${user_id}`, {
      headers: {
        'Authorization': `Bearer ${c.env.SLACK_BOT_TOKEN}`
      }
    });
    const userInfo = await userInfoRes.json<any>();

    if (!userInfo.ok) {
      throw new Error(`users.info failed: ${JSON.stringify(userInfo)}`);
    }

    const username = userInfo.user.real_name || userInfo.user.name;
    const icon_url = userInfo.user.profile.image_192;

    // Get emoji URL
    const list = await getEmojiList(team_id, c.env.EMOJI_KV, c.env.SLACK_BOT_TOKEN);
    const target = list.find(e => e.name === selection);

    if (!target) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Selected emoji not found. Please try again.' }
      });
    }

    // Post message with user's name and icon, using the emoji URL directly
    const messageParams: any = {
      channel: channel,
      text: `:${selection}:`,
      username: username,
      icon_url: icon_url,
      blocks: [
        {
          type: 'image',
          image_url: target.url,
          alt_text: `:${selection}:`
        }
      ]
    };

    // Add thread_ts if in thread
    if (thread_ts) {
      messageParams.thread_ts = thread_ts;
    }

    await slackApi('chat.postMessage', c.env.SLACK_BOT_TOKEN, messageParams);

    return c.json({ response_action: 'clear' });
  }

  // Handle global shortcut modal submission
  if (payload.type === 'view_submission' && payload.view.callback_id === 'bigemoji_modal_global') {
    const team_id = payload.team.id as string;
    const user_id = payload.user.id as string;
    const channelValue = payload.view.state.values['channel_select']?.['channel'];
    const channel = channelValue?.selected_conversation as string;
    const selection = payload.view.state.values['emoji_pick']['emoji_select']
      .selected_option?.value as string;

    if (!channel) {
      return c.json({
        response_action: 'errors',
        errors: { channel_select: 'Please select a channel' }
      });
    }

    if (!selection) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Please select an emoji' }
      });
    }

    // Get user info for username and icon
    const userInfoRes = await fetch(`https://slack.com/api/users.info?user=${user_id}`, {
      headers: {
        'Authorization': `Bearer ${c.env.SLACK_BOT_TOKEN}`
      }
    });
    const userInfo = await userInfoRes.json<any>();

    if (!userInfo.ok) {
      throw new Error(`users.info failed: ${JSON.stringify(userInfo)}`);
    }

    const username = userInfo.user.real_name || userInfo.user.name;
    const icon_url = userInfo.user.profile.image_192;

    // Get emoji URL
    const list = await getEmojiList(team_id, c.env.EMOJI_KV, c.env.SLACK_BOT_TOKEN);
    const target = list.find(e => e.name === selection);

    if (!target) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Selected emoji not found. Please try again.' }
      });
    }

    // Post message with user's name and icon, using the emoji URL directly
    await slackApi('chat.postMessage', c.env.SLACK_BOT_TOKEN, {
      channel: channel,
      text: `:${selection}:`,
      username: username,
      icon_url: icon_url,
      blocks: [
        {
          type: 'image',
          image_url: target.url,
          alt_text: `:${selection}:`
        }
      ]
    });

    return c.json({ response_action: 'clear' });
  }

  // Handle clock in location select modal submission
  if (payload.type === 'view_submission' && payload.view.callback_id === 'clock_in_select_modal') {
    const userId = payload.user.id;
    const location = payload.view.state.values['location_select']['location'].selected_option.value;

    // Determine message based on location
    const defaultMessage = location === 'remote' ? 'リモート出勤しました' : 'オフィス出勤しました';
    const title = location === 'remote' ? 'リモート出勤' : 'オフィス出勤';

    // Save location in metadata for later processing
    const metadata = JSON.stringify({ clock_type: 'clock_in', location });

    // Return updated modal immediately (avoid timeout)
    // Data saving will happen in clock_message_modal submission
    return c.json({
      response_action: 'update',
      view: {
        type: 'modal',
        callback_id: 'clock_message_modal',
        private_metadata: metadata,
        title: { type: 'plain_text', text: title },
        submit: { type: 'plain_text', text: '投稿' },
        close: { type: 'plain_text', text: 'キャンセル' },
        blocks: [
          {
            type: 'input',
            block_id: 'message_input',
            label: { type: 'plain_text', text: 'メッセージ' },
            element: {
              type: 'plain_text_input',
              action_id: 'message',
              initial_value: defaultMessage,
              placeholder: { type: 'plain_text', text: 'メッセージを入力してください' }
            }
          }
        ]
      }
    });
  }

  // Handle clock message modal submission
  if (payload.type === 'view_submission' && payload.view.callback_id === 'clock_message_modal') {
    const userId = payload.user.id;
    const metadata = JSON.parse(payload.view.private_metadata);
    const clockType = metadata.clock_type;
    const location = metadata.location || '';
    const userMessage = payload.view.state.values['message_input']['message'].value;

    // Format final message with location prefix for clock_in
    let finalMessage = userMessage;
    if (clockType === 'clock_in' && location) {
      const locationText = location === 'remote' ? 'リモート出勤しました:house:' : 'オフィス出勤しました:office:';
      finalMessage = userMessage ? `${locationText}\nメッセージ：${userMessage}` : locationText;
    }

    // Process everything in background to avoid timeout
    c.executionCtx.waitUntil((async () => {
      try {
        // Save to KV
        await saveTimeClockKV(c.env.TIME_CLOCKS_KV, userId, clockType);
        console.log('Saved to KV:', userId, clockType);
      } catch (error) {
        console.error('KV save error:', error);
      }

      // If freee token exists, also call freee API (don't let this block Slack posting)
      // Note: break_begin and break_end are only saved to KV for now
      // TODO: Implement freee API integration for break times later
      if (clockType === 'clock_in' || clockType === 'clock_out') {
        try {
          const tokensJson = await c.env.FREEE_TOKENS_KV.get(userId);
          if (tokensJson) {
            const config: FreeeConfig = {
              clientId: c.env.FREEE_CLIENT_ID,
              clientSecret: c.env.FREEE_CLIENT_SECRET,
              redirectUri: c.env.FREEE_REDIRECT_URI
            };

            let tokens: FreeeTokens = JSON.parse(tokensJson);
            tokens = await getValidToken(tokens, config);
            await c.env.FREEE_TOKENS_KV.put(userId, JSON.stringify(tokens));

            const companyId = await getCompanyId(tokens.access_token);

            if (clockType === 'clock_in') {
              await clockIn(tokens.access_token, companyId);
            } else if (clockType === 'clock_out') {
              await clockOut(tokens.access_token, companyId);
            }
            console.log('Freee API success:', clockType);
          }
        } catch (error) {
          console.error('Freee API error (continuing anyway):', error);
        }
      }

      // Post to Slack (always execute regardless of freee API result)
      try {
        // Get user info for username and icon
        const userInfoRes = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
          headers: {
            'Authorization': `Bearer ${c.env.SLACK_BOT_TOKEN}`
          }
        });
        const userInfo = await userInfoRes.json<any>();

        if (userInfo.ok) {
          const username = userInfo.user.real_name || userInfo.user.name;
          const icon_url = userInfo.user.profile.image_192;

          // Get notification channel from environment variable
          const notificationChannel = c.env.NOTIFICATION_CHANNEL_ID || '00_at_wevox_ocean';

          console.log('Posting to channel:', notificationChannel, 'message:', finalMessage);

          // Post to notification channel as user
          const postResult = await slackApi('chat.postMessage', c.env.SLACK_BOT_TOKEN, {
            channel: notificationChannel,
            text: finalMessage,
            username: username,
            icon_url: icon_url
          });

          console.log('Post result:', postResult);
        } else {
          console.error('Failed to get user info:', userInfo);
        }
      } catch (error) {
        console.error('Slack post error:', error);
      }
    })());

    // Return immediately to close modal
    return c.json({ response_action: 'clear' });
  }

  return c.text('');
});

// --- Events (Home Tab) ---
app.post('/slack/events', async (c) => {
  if (!(await verifySlackRequest(c.req.raw, c.env.SLACK_SIGNING_SECRET))) {
    return c.text('Invalid request signature', 401);
  }

  const payload = await c.req.json();

  // URL verification challenge
  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge });
  }

  // Handle app_home_opened event
  if (payload.event?.type === 'app_home_opened') {
    const userId = payload.event.user;
    await publishHomeTab(userId, c.env);
  }

  return c.json({ ok: true });
});

export default app;
