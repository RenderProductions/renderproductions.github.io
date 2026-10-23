# How the Frequency Scanner reads codes

If you're reading this, you found the manual. Congratulations. This is how
`backstage/frequency/signals.json` works.

---

## The basics

1. A visitor types a code into the box on `/backstage/frequency/` and presses Execute.
2. The page fetches `signals.json` (the same folder as the page, never cached).
3. It looks for that code, ignoring upper/lower case and any spaces at the start or end.
4. If found, it runs that code's `actions` one after another.
5. If not found, the screen stays blank and the status line says `CH 01 // NO SIGNAL`.

The input is limited to 40 characters. Codes can contain spaces and symbols.

---

## File layout

```json
{
  "codes": {
    "MYCODE": {
      "actions": [
        { "type": "text", "text": "Hello." },
        { "type": "wait", "ms": 1000 },
        { "type": "redirect", "to": "/" }
      ]
    },
    "ANOTHER CODE": {
      "actions": [ ... ]
    }
  }
}
```

- The top level must have a `codes` object. Without it the page shows `SOURCE OFFLINE`.
- Each key inside `codes` is a code. Write it in any case; matching ignores case.
- Don't create two codes that differ only by case (`"Test"` and `"TEST"`). Only one will win.
- Each code needs an `actions` array. A code without one counts as "no signal".

---

## Actions

Actions run top to bottom. Most of them finish instantly, so the next action starts
right away. Use `wait` when you want a pause.

Exceptions: `text` finishes when it has been fully typed out, `glitch` finishes when
its time is up, and `sound` can wait until the audio ends (see `await`).

### `text`
Types a message on the screen.

| Field | Meaning |
|---|---|
| `text` | The message. Use `\n` for a line break. |
| `theme` | Optional: `"decoy"` or `"rare"`. Changes the screen colors. |
| `instant` | Optional: `true` shows the whole message at once instead of typing it. |

Visitors who prefer reduced motion always get instant text.

### `status`
Replaces the small line at the top of the screen.

| Field | Meaning |
|---|---|
| `text` | The new status line. |

### `theme`
Changes the screen colors without writing anything.

| Field | Meaning |
|---|---|
| `name` | `"decoy"` (dimmer), `"rare"` (red), or `""` for normal. |

### `sound`
Plays an audio file.

| Field | Meaning |
|---|---|
| `src` | Path to the file, for example `/backstage/audio/x7q2.mp3`. |
| `volume` | Optional: 0 to 1. Default 1. |
| `loop` | Optional: `true` repeats it until stopped. Default false. |
| `await` | Optional: `true` makes the next action wait until the sound ends. |

Without `await`, the sound plays in the background while later actions continue.

### `stop`
Stops every sound that is currently playing. No fields.

### `image`
Shows an image on the screen.

| Field | Meaning |
|---|---|
| `src` | Path to the image. |
| `position` | Optional: `"center"` (default), `"full"` (fills the screen), `"top"`, `"bottom"`. |
| `width` | Optional: any CSS width, for example `"50%"` or `"200px"`. |
| `alt` | Optional: description for screen readers. |
| `duration` | Optional: milliseconds before it fades out. Without it, the image stays until `clear` or a new code. |

### `glitch`
Shakes and color-shifts the screen.

| Field | Meaning |
|---|---|
| `ms` | How long, in milliseconds. Default 500. |

Skipped for visitors who prefer reduced motion.

### `wait`
Pauses the sequence.

| Field | Meaning |
|---|---|
| `ms` | How long, in milliseconds. Default 1000. |

### `clear`
Wipes the text and any images. Sounds keep playing and the theme stays.

### `redirect`
Sends the visitor to another page. Nothing after it runs.

| Field | Meaning |
|---|---|
| `to` | Any URL: `"/"`, `"/face/"`, or a full `https://` link. |

---

## Rules worth remembering

- **A new code cancels the old one.** Pending actions, timers, sounds, images, text and
  themes are all cleared before the new code runs.
- **Unknown action types are skipped.** A typo in `type` logs a warning in the browser
  console and the sequence carries on.
- **A broken action doesn't stop the rest.** Errors are logged to the console.
- **Sounds need a click.** Browsers only allow audio after the visitor does something.
  Pressing Execute counts, so sounds from a code work fine.
- **Everything in the repo is public.** The codes, this file, and any sound or image
  files can be opened by anyone who knows or guesses the address. Use random filenames
  for media you want to keep hidden (`x7q2.mp3`, not `secret.mp3`).

---

## JSON gotchas

- No trailing commas after the last item in a list or object.
- No comments. JSON doesn't allow them.
- Quotes inside text need a backslash: `"She said \"hi\""`.
- Every key and string uses double quotes `"`, never single `'`.
- If the page shows `SOURCE OFFLINE`, open the browser console (F12). It says what
  went wrong, usually a typo in the JSON or a wrong file path.

---

## Example: a full sequence

```json
"BLACKOUT": {
  "actions": [
    { "type": "status", "text": "CH 01 // POWER FAILURE" },
    { "type": "sound", "src": "/backstage/audio/hum.mp3", "loop": true, "volume": 0.5 },
    { "type": "glitch", "ms": 800 },
    { "type": "text", "theme": "rare", "text": "Something is out there.\nDon't look." },
    { "type": "wait", "ms": 2500 },
    { "type": "image", "src": "/backstage/img/k3m9.png", "position": "full", "duration": 3000 },
    { "type": "wait", "ms": 3500 },
    { "type": "stop" },
    { "type": "clear" },
    { "type": "redirect", "to": "/face/" }
  ]
}
```

---

## Adding new action types

Actions live in the `ACTIONS` object in `backstage/frequency/index.html`. Each one is a
function that takes the action's settings and returns a promise. To add one, write a
new entry there, then use its name as `type` in the JSON. Ideas not built yet:
video playback, screen shake without color shift, a countdown, `localStorage` flags
that unlock things on other pages.