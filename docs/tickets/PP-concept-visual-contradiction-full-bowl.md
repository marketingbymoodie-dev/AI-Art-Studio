# Petposterous: concept/visual contradiction — "dinner is late" rendered with a full bowl

**Type:** concept / visual-brief issue (not a model or provider issue).
**Found:** 2026-10-02, staging Flare validation T3 (job `7c6b2864-191f-40b4-891a-d6cd742798a4`, look Character, words "NOTED. AGAIN.").

## What happened
Story: "He waits by the fridge every evening and sighs loudly if dinner is one minute late."
The rendered artwork shows the dog sighing beside the fridge — next to a **full** food bowl. The joke depends on the bowl being empty (dinner is late), so the prop contradicts the punchline.

## Why it is not a provider issue
The image model rendered the props it was given latitude to choose. Nothing in the concept's visual joke or the composed prompt states the bowl must be empty, so "food bowl" was free to be drawn full. The same gap would exist on any renderer.

## Where to look
- Concept writer output (`visualJoke`) — should name the state of story-critical props ("empty bowl").
- Petposterous creative base / renderer guidance — consider a general rule: props that carry the joke must be drawn in the state the story requires; do not add props that contradict it.

## Do not
- Fix by switching renderer/model; this is brief content.
- Change prompts as part of the provider migration (kept separate for clean comparison data).
