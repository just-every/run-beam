# Fonts

Every face is self-hosted under the SIL Open Font License 1.1, with its licence beside the file. No page loads fonts
from another origin.

| Face | File | Licence | Upstream | Used for |
| --- | --- | --- | --- | --- |
| Roboto Serif Display (static: width 50, weight 800, optical size 144, Latin) | `roboto-serif/roboto-serif-display-800.woff2` | `roboto-serif/LICENSE.txt` | https://github.com/googlefonts/RobotoSerif | run site headings, the wordmark, and sign-in and `/setup` headings |
| Inter (variable, 100–900, Latin) | `inter/inter-latin-wght-normal.woff2` | `inter/LICENSE.txt` | https://github.com/rsms/inter | body text everywhere: the run site, the installed app, sign-in and `/setup` |
| Roboto Condensed (variable, Latin) | `roboto-condensed/roboto-condensed-latin-wght-normal.woff2` | `roboto-condensed/LICENSE.txt` | https://github.com/googlefonts/roboto-classic | the app's titles, big numbers and rail wordmark; the hero cards' long lines |
| JetBrains Mono (variable, Latin) | `jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2` | `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono | commands on the run site |

Every Beam document declares its faces through `public/site/fonts.css`: the run site and the installed app link it, and Base's sign-in, `/setup` and Lobby reach it through `/fonts/fonts.css`. The installer reads only `/rer-theme.css`, which repeats the four faces: change both. Roboto Serif Display is an instance of Roboto Serif's
variable font (fontsource 5.3.0) pinned at the axes the design desk used and subset to Latin-1 plus typographic
punctuation; Inter, Roboto Condensed and JetBrains Mono are fontsource 5.3.0's Latin subsets.
