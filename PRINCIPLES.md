# CLAW Principles

These are load-bearing. Features get judged against them; when they conflict,
the principle wins.

## The product

1. **Free means free.** The browser app is the full instrument, forever. Nothing
   in it is locked, gated, metered, or nagged.
2. **No server. No account. No cloud.** CLAW is a static page. Your patterns
   live in URLs and files you own. If our host disappears, your music doesn't.
3. **Downloadable-and-double-click.** The repo runs from `file://`. Every
   feature must either work there or degrade silently (the service worker and
   WebMIDI do; nothing may break).
4. **Bring your own AI key.** AI is optional, keys stay in your browser and go
   straight to your provider. We will never sell AI credits or proxy your
   prompts.
5. **One design language.** Nothing × Teenage Engineering: hardware-grey chassis,
   black panel, dot matrix, one signal orange. Restraint is the feature.

## The money (the pledge)

6. **Paid = packaging and content, never capability.** Desktop builds
   (convenience), style packs (content), branded editions (identity). Client-side
   feature gates in MIT code are theater — we don't perform it.
7. **No subscriptions for the instrument. No ads. No telemetry.** There is no
   analytics code in CLAW and there never will be.
8. **"CLAW cloud sync" is a permanent no.** Any future idea that requires
   accounts or servers is out of scope for this project, full stop.

## The code

9. **Buildless, permanently.** Vanilla JS, no bundler, no TypeScript. The three
   readable source files are the contributor onboarding. (`@ts-check` JSDoc and
   `node --test` on pure functions are welcome; toolchains are not.)
10. **One format, one sanitizer.** Share links, project files, autosave, AI
    output, and future packs are the same versioned schema through the same
    clamping entry point. Old share URLs parse forever.
11. **One trigger path.** Live playback and offline export share the same code.
    A feature that sounds different in the export than live is a bug.
12. **Voices render on OfflineAudioContext or they don't ship.** That constraint
    is what makes export, stems, and song rendering free.
13. **Core stays 8 voices.** Community synth voices and generator styles live in
    packs and `community/`, entering by curated PR. No sandbox pretense: data-only
    JSON loads freely, JS loads only from this repo.

## Won't build

- Per-user backends of any kind (galleries, profiles, sync)
- SharedArrayBuffer/COOP-COEP features (GitHub Pages can't set the headers)
- DRM or license checks in the client
- An AI that runs without the user's own key
