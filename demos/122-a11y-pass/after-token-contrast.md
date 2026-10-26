# Existing token contrast supplement

These calculations supplement axe incomplete results caused by gradients. They do not replace visual review of every rendered element. See the proof README for token changes between phases. Both body radial glows are conservatively composited at maximum alpha simultaneously over the body background; actual glow centers differ.

| Foreground | Background | Contrast | Required | Result |
| --- | --- | ---: | ---: | --- |
| fg | bg | 16.93:1 | 4.5:1 | pass |
| fg-muted | bg | 7.16:1 | 4.5:1 | pass |
| fg-subtle | bg | 5.71:1 | 4.5:1 | pass |
| brand | bg | 5.68:1 | 4.5:1 | pass |
| border-control | bg | 3.58:1 | 3:1 | pass |
| ok | ok-soft over bg | 8.59:1 | 4.5:1 | pass |
| warn | warn-soft over bg | 8.47:1 | 4.5:1 | pass |
| danger | danger-soft over bg | 5.92:1 | 4.5:1 | pass |
| idle | idle-soft over bg | 5.59:1 | 4.5:1 | pass |
| brand | brand-soft over bg | 5.16:1 | 4.5:1 | pass |
| fg | bg-elevated | 15.97:1 | 4.5:1 | pass |
| fg-muted | bg-elevated | 6.75:1 | 4.5:1 | pass |
| fg-subtle | bg-elevated | 5.39:1 | 4.5:1 | pass |
| brand | bg-elevated | 5.36:1 | 4.5:1 | pass |
| border-control | bg-elevated | 3.38:1 | 3:1 | pass |
| ok | ok-soft over bg-elevated | 7.90:1 | 4.5:1 | pass |
| warn | warn-soft over bg-elevated | 7.79:1 | 4.5:1 | pass |
| danger | danger-soft over bg-elevated | 5.49:1 | 4.5:1 | pass |
| idle | idle-soft over bg-elevated | 5.17:1 | 4.5:1 | pass |
| brand | brand-soft over bg-elevated | 4.78:1 | 4.5:1 | pass |
| fg | surface | 15.40:1 | 4.5:1 | pass |
| fg-muted | surface | 6.51:1 | 4.5:1 | pass |
| fg-subtle | surface | 5.20:1 | 4.5:1 | pass |
| brand | surface | 5.17:1 | 4.5:1 | pass |
| border-control | surface | 3.26:1 | 3:1 | pass |
| ok | ok-soft over surface | 7.55:1 | 4.5:1 | pass |
| warn | warn-soft over surface | 7.45:1 | 4.5:1 | pass |
| danger | danger-soft over surface | 5.26:1 | 4.5:1 | pass |
| idle | idle-soft over surface | 4.95:1 | 4.5:1 | pass |
| brand | brand-soft over surface | 4.57:1 | 4.5:1 | pass |
| fg | surface-hover | 14.30:1 | 4.5:1 | pass |
| fg-muted | surface-hover | 6.04:1 | 4.5:1 | pass |
| fg-subtle | surface-hover | 4.83:1 | 4.5:1 | pass |
| brand | surface-hover | 4.80:1 | 4.5:1 | pass |
| border-control | surface-hover | 3.02:1 | 3:1 | pass |
| ok | ok-soft over surface-hover | 6.93:1 | 4.5:1 | pass |
| warn | warn-soft over surface-hover | 6.83:1 | 4.5:1 | pass |
| danger | danger-soft over surface-hover | 4.85:1 | 4.5:1 | pass |
| idle | idle-soft over surface-hover | 4.56:1 | 4.5:1 | pass |
| brand | brand-soft over surface-hover | 4.21:1 | 4.5:1 | FAIL |
| fg | body-gradient-upper-bound | 15.45:1 | 4.5:1 | pass |
| fg-muted | body-gradient-upper-bound | 6.53:1 | 4.5:1 | pass |
| fg-subtle | body-gradient-upper-bound | 5.22:1 | 4.5:1 | pass |
| brand | body-gradient-upper-bound | 5.19:1 | 4.5:1 | pass |
| border-control | body-gradient-upper-bound | 3.27:1 | 3:1 | pass |
| ok | ok-soft over body-gradient-upper-bound | 7.68:1 | 4.5:1 | pass |
| warn | warn-soft over body-gradient-upper-bound | 7.55:1 | 4.5:1 | pass |
| danger | danger-soft over body-gradient-upper-bound | 5.28:1 | 4.5:1 | pass |
| idle | idle-soft over body-gradient-upper-bound | 4.99:1 | 4.5:1 | pass |
| brand | brand-soft over body-gradient-upper-bound | 4.57:1 | 4.5:1 | pass |
| white | brand-strong | 5.70:1 | 4.5:1 | pass |
| white | brand-deep | 7.11:1 | 4.5:1 | pass |
