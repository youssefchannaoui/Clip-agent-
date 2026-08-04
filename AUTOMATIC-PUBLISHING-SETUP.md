# Automatic Publishing Setup

## Callback URLs

Replace the hostname with the deployed app URL and register the exact URLs:

- Google: `/auth/youtube/callback`
- Meta: `/auth/meta/callback`
- TikTok: `/auth/tiktok/callback`

## Safe activation order

1. Set `APP_PASSWORD` and deploy.
2. Keep the master publishing switch off.
3. Add one provider's credentials.
4. Connect that account in the Publishing tab.
5. Run **Test connection**.
6. Select the account and platform privacy.
7. Enable the platform and master switch.
8. Test one private post.
9. Enable other platforms one at a time.

## YouTube

- Enable YouTube Data API v3.
- Configure an OAuth web client.
- Add the callback URL.
- The app requests `youtube.upload` and `youtube.readonly`.
- Use Private for the first test.

## Meta

The authorised user must manage a Facebook Page. Instagram requires a professional Instagram account connected to that Page.

Requested permissions:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `instagram_basic`
- `instagram_content_publish`

The Meta app may require review before accounts outside app roles can use these permissions.

## TikTok

- Add Content Posting API.
- Enable Direct Post.
- Request `video.publish` and `user.info.basic`.
- Run Test connection before enabling TikTok so the latest creator options are loaded.
- The creator must manually approve each clip in DeenClipped.
- Unaudited clients are limited to private/`SELF_ONLY` behaviour.

## Troubleshooting

- **OAuth not configured:** verify the client/app ID and secret exist in Render.
- **Redirect mismatch:** ensure the developer dashboard callback is character-for-character identical.
- **Stored credentials unreadable:** restore the original `SOCIAL_TOKEN_KEY` or reconnect accounts.
- **Instagram missing:** verify the Instagram account is professional and linked to the selected Page.
- **Facebook refused:** keep clips at 60 seconds or less.
- **TikTok privacy rejected:** run Test connection and choose one of the returned privacy options.
- **Upload retrying:** leave the app running; saved upload sessions resume automatically up to `SOCIAL_MAX_ATTEMPTS`.
