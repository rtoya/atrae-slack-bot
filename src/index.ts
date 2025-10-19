import { Hono } from 'hono';
import { verifySlackRequest } from './slack';
import { slackApi } from './slack-api';
import { getEmojiList, filterEmojiOptions } from './emoji';

type Bindings = {
  EMOJI_KV: KVNamespace;
  SLACK_BOT_TOKEN: string;
  SLACK_USER_TOKEN?: string;
  SLACK_SIGNING_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check endpoint
app.get('/healthz', (c) => c.text('ok'));

// --- Slash Command ---
app.post('/slack/command', async (c) => {
  if (!(await verifySlackRequest(c.req.raw, c.env.SLACK_SIGNING_SECRET))) {
    return c.text('Invalid request signature', 401);
  }

  const form = await c.req.formData();
  const trigger_id = String(form.get('trigger_id') ?? '');
  const channel_id = String(form.get('channel_id') ?? '');
  const thread_ts = String(form.get('thread_ts') ?? ''); // Get thread_ts if in thread

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
