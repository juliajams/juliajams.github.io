# Yuliia Shtefan — Portfolio (immersive edition)

Two separate things live in this folder. Mixing them up is the most common confusion:

| | What it is | Where | Who sees it |
|---|---|---|---|
| **The website** | The finished portfolio (hero, projects, expertise, about, contact) | the `docs/` folder | Everyone |
| **The editor** | A visual tool to change text/images and publish | the `admin/` folder | Only you, on your own computer |

The **GitHub** and **Publish** buttons you may have seen belong to the *editor*. They are never part of the website.
If you ever see them in your browser, you opened the editor, not the site.

```
docs/          ← THE WEBSITE (generated; this is the only folder that goes public)
js/warp.js     ← the mouse-warped headline effect (WebGL)
js/hero.js     ← the hero's interactive gradient blob / interactive photo (WebGL)
js/main.js     ← menu, rolling-letter links, magnetic buttons, spinning text, project hover image
content/       ← site.json: all your text, image paths and structure
admin/         ← the visual editor
src/           ← code that turns site.json into the website
css/ js/ fonts/ images/   ← design, scripts, self-hosted fonts, pictures
build.mjs      ← rebuilds docs/ from content/site.json
serve.mjs      ← starts the editor on your computer
Start editor.command / Start editor.bat   ← double-click to start the editor
```

---

## The animated headlines

Big headlines (your name, section titles, project names, "Let's talk") bend like liquid around the mouse: they
magnify under the pointer, smear in the direction you move, ripple outwards and pick up a thin colour fringe.
Scrolling adds a gentle shear, and headlines rise into place as they appear. Around it:

* Nav links roll their letters upward on hover, and buttons lean slightly toward the cursor.
* The circular text beside your name spins and speeds up as you scroll (change its words in **Hero → Circular text**).
* On the project list, hovering a row shows its cover image following the cursor; on phones the covers show inline.
* The first paragraph of **About** lights up word by word as you scroll.

**It is safe by design.** The real text always stays in the page (for Google, screen readers and copy/paste). If the
visitor prefers reduced motion, has no WebGL, or JavaScript is off, they simply see normal text. Add `?nowarp` to any
page address to switch the effect off, e.g. `https://you.github.io/repo/?nowarp`.

**Tuning:** the look of the distortion lives in the short shader at the top of `js/warp.js` (strength of the lens,
smear, ripples and colour fringe are single numbers). Fonts are self-hosted in `fonts/`.

**In the editor** use the **Edit / Effects** switch at the top: *Edit* shows plain text you can click and type into;
*Effects* shows the site exactly as visitors see it, with the animations (typing is disabled there).

## Light and dark themes

The header has a sun/moon button. Visitors can switch themes, and their choice is remembered on their device.
Dark is near-black with warm ivory text; light is off-white with graphite text. The red accent is the same in both.

* **Default for first-time visitors:** *Site tab → Default colour theme* (follow the visitor's device, always dark, or always light).
* **Colours:** the two palettes are the `:root` blocks at the top of `css/style.css` (`--bg`, `--fg`, `--muted`, `--line`…).
  The accent red is `--accent` and is shared.
* **In the editor**, the **Dark / Light** switch in the top bar changes only what you are previewing.
* Placeholder images are dark grey boxes; real photos will replace them.

## The hero

A minimal opening: your name top-left in the header, the role label, your intro and one link, with an interactive layer behind them.
Choose it in **Hero → Hero visual**:

* **Gradient blob** (default, needs no image): a single soft, irregular shape with a magenta → coral → amber gradient and film grain.
  It floats across the entire hero (no frame or panel), follows the cursor, stretches in the direction it travels, grows while the cursor
  moves and shrinks when it stops. With the cursor away it wanders slowly by itself.
* **Interactive photo**: your photo fills the whole hero behind the text and bends under the cursor.

The round "Available for new projects" badge at the bottom right is optional: clear **Hero → Circular text** to hide it.
The blob's shape, colours, grain and behaviour are plain numbers in the shader at the top of `js/hero.js`
(`c0`, `c1`, `c2` are the three gradient colours; the radius and growth are in `draw`). With reduced motion it is a still frame;
without WebGL a soft gradient shape is shown instead.

## Project pages

Text runs in two columns that line up with the Services/Brief row and the image rows, at a slightly smaller size.
Consecutive paragraphs flow together; one image spans the full width, two images sit in the same two columns.

## Project list

Hovering a project row shows its cover image following the cursor. The image fades out as it nears the round arrow button,
so it never covers it.

---

## 1. Put the website online (about 5 minutes)

1. Create a repository on GitHub (e.g. `portfolio`) and upload **everything in this folder** to it
   (drag-and-drop in the GitHub page works; hidden files are fine to skip).
2. Repo → **Settings → Pages** → *Build and deployment* → **Deploy from a branch** →
   Branch `main`, folder **`/docs`** → **Save**.
3. After a minute or two your website is live at `https://<your-username>.github.io/<repo>/`.

That's it — you should see the portfolio, not the editor. Only the `docs/` folder is served at that address;
`admin/`, `content/`, `src/` are **not reachable** through the website's URL.

> **About privacy.** On a free GitHub account, GitHub Pages needs a *public* repository, which means people who
> visit your GitHub page can read the source files (not the editor's token — that never leaves your computer).
> If you need the source hidden too, use section 4.

## 2. Use the visual editor

1. Install **Node.js** once (<https://nodejs.org>, the "LTS" button).
2. Double-click **Start editor.command** (Mac) or **Start editor.bat** (Windows).
   Your browser opens the editor at `http://localhost:8000/admin/`. Keep the black window open while you edit.
   (It listens only on your computer — nobody else can reach it.)
3. **One-time connection.** Click **GitHub**, then enter your username, repository name, and a token:
   <https://github.com/settings/personal-access-tokens/new> → *Only select repositories* → your repo →
   Permissions → **Contents: Read and write**. The token is stored only in your browser.
4. **Edit.** Click any text in the preview and type; click any image to replace it. The left panel adds, removes
   and reorders things: tags, expertise lines, social links, projects, text blocks, image rows.
   Double-click selects a word, triple-click selects the whole line.
5. **Publish.** One commit updates the website files in `docs/` and your content. GitHub Pages shows it ~1 minute later.
   Nothing changes on the live site until you press Publish.

Images are shrunk automatically (max 2400 px) and PNG transparency is kept.
The **Site** tab has the Google title/description, link-preview image, favicon, and a backup download.

## 3. Editing without the editor

```bash
node build.mjs        # rebuilds docs/ from content/site.json
```

Change `content/site.json` for copy, `css/style.css` for design, `src/render.js` for page structure, then rebuild and
commit `docs/`.

## 4. Keep the source private too (optional)

The live website is public by nature. What you can hide is everything *behind* it. Two ways:

**A — Netlify / Cloudflare Pages (free).** Make the GitHub repo **private**, import it on one of those services, and set
*Build command* `node build.mjs`, *Publish directory* `docs`. They serve only `docs/`; the repo stays private.
(Vercel's free plan is for non-commercial use — check its terms before using it for a business portfolio.)

**B — Stay on GitHub with two repositories.** Keep this repo private; a public second repo holds only the built site.
`.github/workflows/deploy.yml` does the copy automatically — open that file and follow the 3 setup steps at the top.

In both cases the editor still runs on your computer and Publish saves into the private repo.

## Troubleshooting

| What you see | What it means / fix |
|---|---|
| **GitHub** + **Publish** buttons and a left panel | That's the editor, not the website. The website's address is the plain `…github.io/<repo>/`. |
| Editor shows a red box "could not start" | Use **Start editor** instead of opening the file directly, and keep the whole folder together. |
| `404` on your GitHub Pages address | Settings → Pages: branch `main`, folder `/docs`. Make sure `docs/index.html` is in the repo. |
| "GitHub rejected the token" | Token mistyped/expired — create a new one. |
| "The token isn't allowed to do that" | Token needs **Contents: Read and write** on this repository. |
| "Repository or branch not found" | Check owner / repo / branch spelling and that the token covers this repo. |
| Published but nothing changed | Wait 1–2 minutes and hard-refresh (Ctrl/Cmd + Shift + R); check the repo's **Actions** tab. |
| Two people / two devices editing | Reload the editor before editing — the last Publish wins. |
