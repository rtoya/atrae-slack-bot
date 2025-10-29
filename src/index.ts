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
  getCompanyId,
  type FreeeConfig,
  type FreeeTokens
} from './freee';

type Bindings = {
  EMOJI_KV: KVNamespace;
  FREEE_TOKENS_KV: KVNamespace;
  SLACK_BOT_TOKEN: string;
  SLACK_USER_TOKEN?: string;
  SLACK_SIGNING_SECRET: string;
  FREEE_CLIENT_ID: string;
  FREEE_CLIENT_SECRET: string;
  FREEE_REDIRECT_URI: string;
};

const app = new Hono<{ Bindings: Bindings }>();

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
    const config: FreeeConfig = {
      clientId: c.env.FREEE_CLIENT_ID,
      clientSecret: c.env.FREEE_CLIENT_SECRET,
      redirectUri: c.env.FREEE_REDIRECT_URI
    };

    // Check if user has tokens
    const tokensJson = await c.env.FREEE_TOKENS_KV.get(user_id);
    if (!tokensJson) {
      const authUrl = `${c.env.FREEE_REDIRECT_URI.replace('/freee/callback', '/freee/auth')}?user_id=${user_id}`;
      return c.json({
        response_type: 'ephemeral',
        text: `freeeの認証が必要です。以下のURLから認証を行ってください:\n${authUrl}`
      });
    }

    try {
      let tokens: FreeeTokens = JSON.parse(tokensJson);
      tokens = await getValidToken(tokens, config);
      await c.env.FREEE_TOKENS_KV.put(user_id, JSON.stringify(tokens));

      const companyId = await getCompanyId(tokens.access_token);
      await clockIn(tokens.access_token, companyId);

      // Post to Slack
      await slackApi('chat.postMessage', c.env.SLACK_BOT_TOKEN, {
        channel: channel_id,
        text: `<@${user_id}> が出勤しました`
      });

      return c.json({
        response_type: 'ephemeral',
        text: '出勤を記録しました'
      });
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
    const config: FreeeConfig = {
      clientId: c.env.FREEE_CLIENT_ID,
      clientSecret: c.env.FREEE_CLIENT_SECRET,
      redirectUri: c.env.FREEE_REDIRECT_URI
    };

    // Check if user has tokens
    const tokensJson = await c.env.FREEE_TOKENS_KV.get(user_id);
    if (!tokensJson) {
      const authUrl = `${c.env.FREEE_REDIRECT_URI.replace('/freee/callback', '/freee/auth')}?user_id=${user_id}`;
      return c.json({
        response_type: 'ephemeral',
        text: `freeeの認証が必要です。以下のURLから認証を行ってください:\n${authUrl}`
      });
    }

    try {
      let tokens: FreeeTokens = JSON.parse(tokensJson);
      tokens = await getValidToken(tokens, config);
      await c.env.FREEE_TOKENS_KV.put(user_id, JSON.stringify(tokens));

      const companyId = await getCompanyId(tokens.access_token);
      await clockOut(tokens.access_token, companyId);

      // Post to Slack
      await slackApi('chat.postMessage', c.env.SLACK_BOT_TOKEN, {
        channel: channel_id,
        text: `<@${user_id}> が退勤しました`
      });

      return c.json({
        response_type: 'ephemeral',
        text: '退勤を記録しました'
      });
    } catch (error) {
      console.error('Clock out error:', error);
      return c.json({
        response_type: 'ephemeral',
        text: `エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // Existing bigemoji command (default)
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

  return c.text('');
});

export default app;
