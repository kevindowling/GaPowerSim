# No AI writing

Applies to game text, the README, code comments, commit messages, pull requests and replies.
Guide: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing

## All writing

- Use plain words and short sentences. State facts and numbers.
- No em dashes.
- No "X, not Y" or "not just X, but Y".
- No groups of three for rhythm.
- No aphorisms, taglines or closing lines that sum up.
- No inflated words: robust, seamless, crucial, comprehensive, leverage, delve, showcase.
- No sentence that explains why the work matters.
- Say a thing once. Drop what the reader can already see.
- No self-attribution in commits or pull requests.

## Code comments

- One short line with a fact the code does not show, or no comment.
- No docblocks that justify a design.
- No file header essays.

Bad:

```ts
/**
 * Nine steps. A step completes when the game state shows the player did it, so
 * steps can finish out of order and none of them waits on a dialog.
 */
```

Good:

```ts
/** Index into BEATS. */
```

## Game text

- Tell the player what happened, what it costs and when.
- Name things the way a player would. Keep "Power at Data Center Campus".
- Labels are short. Skip a heading that repeats the obvious.
- Give sources for real-world claims.
- Say so when a number is invented or assumed.

# Interface

Follow Impeccable's Operate guidance: https://github.com/pbakaus/impeccable

- Show details at the cursor or beside what was clicked.
- Use a symbol on the map where it can replace a sentence.
- No cards with a colored side stripe.
- No eyebrow labels above headings.
- No cards inside cards.
- Use a modal only when a choice blocks play.
- One typeface, Public Sans, with good contrast.
- Keep the pine header, white panels and clay action color.
- On phones, details go in the bottom sheet.

Check with:

```bash
npx --yes impeccable detect src/ui src/styles
```
