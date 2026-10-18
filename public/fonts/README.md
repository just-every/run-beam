# Fonts

Every face is self-hosted under the SIL Open Font License 1.1, with its licence beside the file. No page loads fonts
from another origin.

| Face | File | Licence | Upstream | Used for |
| --- | --- | --- | --- | --- |
| Lexend (variable, 100–900) | `lexend/lexend-latin-wght-normal.woff2` | `lexend/LICENSE.txt` | https://github.com/googlefonts/lexend | the installed app, sign-in and `/setup` (`/fonts/fonts.css`) |
| Roboto Serif Display (static: width 50, weight 800, optical size 144, Latin) | `roboto-serif/roboto-serif-display-800.woff2` | `roboto-serif/LICENSE.txt` | https://github.com/googlefonts/RobotoSerif | run site headings and the wordmark |
| Inter (variable, 100–900, Latin) | `inter/inter-latin-wght-normal.woff2` | `inter/LICENSE.txt` | https://github.com/rsms/inter | run site body |
| Roboto Condensed (variable, Latin) | `roboto-condensed/roboto-condensed-latin-wght-normal.woff2` | `roboto-condensed/LICENSE.txt` | https://github.com/googlefonts/roboto-classic | the hero cards' long lines |
| JetBrains Mono (variable, Latin) | `jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2` | `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono | commands on the run site |

The run site declares its faces in `public/site/fonts.css`. Roboto Serif Display is an instance of Roboto Serif's
variable font (fontsource 5.3.0) pinned at the axes the design desk used and subset to Latin-1 plus typographic
punctuation; Inter, Roboto Condensed and JetBrains Mono are fontsource 5.3.0's Latin subsets.
