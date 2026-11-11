# T3 Car

A hands-free companion to the T3 Code mobile app, for driving. Pick a thread, and from then on
you only talk and listen:

- **Joining is silent.** Nothing is sent and the thread's history is not read aloud. T3 Car
  follows the thread and speaks only what the agent writes after you joined, sentence by
  sentence while it streams, including its short remarks between tool calls.
- **The microphone stays open.** Speak whenever you want, also while the agent works or talks
  (talking cuts it off). While the agent works your message reaches the running turn.
- **You never have to answer.** Staying quiet sends nothing; the app keeps following.
- **Approvals and questions get large buttons**, and "ja" / "nee" work by voice.

It is a separate Expo app next to `apps/mobile`. The screens, the spoken loop and the audio are
its own; pairing, the connection, thread state and the message outbox come from
`packages/contracts`, `packages/client-runtime` and the non-visual modules of `apps/mobile`, so
it speaks the same protocol as the T3 Code app and `apps/mobile` needs no changes for it.

## Speech

Apple's on-device speech recognition runs continuously and only decides when you start and stop
talking. With an OpenAI API key (Settings in the app, stored in the Keychain) OpenAI transcribes
what you said and reads the agent aloud. Without a key, or without reach, the on-device
transcript and the iOS voice are used instead.

## Running it

T3 Car pairs directly with a T3 Code server over your LAN or tailnet: create a pairing link in
T3 Code under Settings › Sharing & access and scan it. It has no T3 Connect sign-in.

Signing uses your own team. Put these in the repository's `.env.local`:

```bash
T3CAR_IOS_BUNDLE_ID=com.example.t3car
T3CAR_IOS_TEAM_ID=ABCDE12345
```

```bash
vp i
cd apps/car
vp run ios:device   # Release build on a connected iPhone
vp run ios          # simulator, with `vp run dev` for Metro
vp run test
vp run typecheck
```

iOS only for now.
