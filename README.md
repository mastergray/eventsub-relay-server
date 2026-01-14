# eventsub-relay-server

For relaying EventSub notifications from Twitch to some other service

## TODO

- Double check using "secret" witk cookie-parser
- Use [ws](https://www.npmjs.com/package/ws) for working with web-sockets
- [Handle events](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/) using WebSockets to get notificatons with
- See if we can detect commands from chat

## Notes

- Refresh tokens for confidential apps do not expire
- To get user ID from Twitch API:

```bash
curl -X GET "https://api.twitch.tv/helix/users" \
  -H "Authorization: Bearer YOUR_USER_ACCESS_TOKEN" \
  -H "Client-Id: YOUR_CLIENT_ID"
```

## Resources

- [Twitch CLI Setup](https://dev.twitch.tv/docs/cli/configure-command/)
- [Twitch CLI Websocke Events](https://dev.twitch.tv/docs/cli/websocket-event-command/)