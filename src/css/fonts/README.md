# Fonts

The picker sets its tab names and colour names in Roboto, and every other word in Roboto
Mono, so hex values, channel numbers and percentages keep their columns as they change. Each
family ships as its regular weight alone, cut to the Latin characters; a bold or an italic a
widget's style asks for is synthesised by the browser, and a character outside the cut falls
back to the system's own faces.

| File | Made from | Licence |
|---|---|---|
| `roboto/Roboto-Regular-latin.woff2` | Roboto Regular 2.137, by Google | Apache License 2.0, in `roboto/LICENSE.txt` |
| `roboto-mono/RobotoMono-Regular-latin.woff2` | Roboto Mono Regular 3.001, from [googlefonts/RobotoMono](https://github.com/googlefonts/RobotoMono) at commit `111eb14` | SIL Open Font License 1.1, in `roboto-mono/OFL.txt` |

Both files are modified from those originals. Each was subset to the Latin range below,
keeping its hinting and its whole name table, copyright and licence fields among them, and
saved as WOFF2 with fontTools 4.60.2 on 18 November 2026:

```sh
pyftsubset <font>.ttf --flavor=woff2 --name-IDs='*' \
  --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
```

Roboto and Roboto Mono are trademarks of Google.
