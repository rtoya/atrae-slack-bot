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

    // Get emoji URL
    const list = await getEmojiList(team_id, c.env.EMOJI_KV, c.env.SLACK_BOT_TOKEN);
    const target = list.find(e => e.name === selection);

    if (!target) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Selected emoji not found. Please try again.' }
      });
    }

    // Download the emoji image
    const imageRes = await fetch(target.url);
    if (!imageRes.ok) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Failed to download emoji image. Please try again.' }
      });
    }

    const imageBuffer = await imageRes.arrayBuffer();

    // Determine file extension from URL or content type
    const contentType = imageRes.headers.get('content-type') || 'image/png';
    const ext = contentType.split('/')[1] || 'png';
    const filename = `${selection}.${ext}`;

    // Post as file using user token (if available) or bot token
    const token = c.env.SLACK_USER_TOKEN || c.env.SLACK_BOT_TOKEN;

    // Step 1: Get upload URL using files.getUploadURLExternal
    const getUrlBody = new URLSearchParams({
      filename: filename,
      length: imageBuffer.byteLength.toString()
    });

    const getUrlApiRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: getUrlBody
    });

    const getUrlRes = await getUrlApiRes.json<any>();

    if (!getUrlRes.ok) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: `Failed to get upload URL: ${getUrlRes.error}` }
      });
    }

    const uploadUrl = getUrlRes.upload_url;
    const fileId = getUrlRes.file_id;

    // Step 2: Upload file to the URL
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      body: imageBuffer
    });

    if (!uploadRes.ok) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Failed to upload file. Please try again.' }
      });
    }

    // Step 3: Complete the upload and share to channel
    const completeParams: any = {
      files: [
        {
          id: fileId,
          title: `:${selection}:`
        }
      ],
      channel_id: channel
    };

    // Add thread_ts if in thread
    if (thread_ts) {
      completeParams.thread_ts = thread_ts;
    }

    await slackApi('files.completeUploadExternal', token, completeParams);

    return c.json({ response_action: 'clear' });
  }

  // Handle global shortcut modal submission
  if (payload.type === 'view_submission' && payload.view.callback_id === 'bigemoji_modal_global') {
    const team_id = payload.team.id as string;
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

    // Get emoji URL
    const list = await getEmojiList(team_id, c.env.EMOJI_KV, c.env.SLACK_BOT_TOKEN);
    const target = list.find(e => e.name === selection);

    if (!target) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Selected emoji not found. Please try again.' }
      });
    }

    // Download the emoji image
    const imageRes = await fetch(target.url);
    if (!imageRes.ok) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Failed to download emoji image. Please try again.' }
      });
    }

    const imageBuffer = await imageRes.arrayBuffer();

    // Determine file extension from URL or content type
    const contentType = imageRes.headers.get('content-type') || 'image/png';
    const ext = contentType.split('/')[1] || 'png';
    const filename = `${selection}.${ext}`;

    // Post as file using user token (if available) or bot token
    const token = c.env.SLACK_USER_TOKEN || c.env.SLACK_BOT_TOKEN;

    // Step 1: Get upload URL using files.getUploadURLExternal
    const getUrlBody = new URLSearchParams({
      filename: filename,
      length: imageBuffer.byteLength.toString()
    });

    const getUrlApiRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: getUrlBody
    });

    const getUrlRes = await getUrlApiRes.json<any>();

    if (!getUrlRes.ok) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: `Failed to get upload URL: ${getUrlRes.error}` }
      });
    }

    const uploadUrl = getUrlRes.upload_url;
    const fileId = getUrlRes.file_id;

    // Step 2: Upload file to the URL
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      body: imageBuffer
    });

    if (!uploadRes.ok) {
      return c.json({
        response_action: 'errors',
        errors: { emoji_pick: 'Failed to upload file. Please try again.' }
      });
    }

    // Step 3: Complete the upload and share to channel
    await slackApi('files.completeUploadExternal', token, {
      files: [
        {
          id: fileId,
          title: `:${selection}:`
        }
      ],
      channel_id: channel
    });

    return c.json({ response_action: 'clear' });
  }

  return c.text('');
});

export default app;
