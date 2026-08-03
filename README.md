# Average Derivative EDR Lab

Interactive laboratory for the modified, locally centered single-index
average-derivative procedure in the model

\[
Y = f(\beta^\top X) + \varepsilon.
\]

Try the deployed application at
[average-derivative-edr-lab.n-spokoinyi.chatgpt.site](https://average-derivative-edr-lab.n-spokoinyi.chatgpt.site/).

## What the lab includes

- Sine and `t sin(st)` link-function families with adjustable frequency.
- Adjustable sample size, dimension, noise level and design correlation.
- Locally centered average-derivative initialization with optional `N_lin`
  optimization.
- Alternating optimization along a multiscale structural-adaptation path.
- Adjustable `N_loc`, `N_J`, `N_phi`, penalty, scale decrease and stopping
  bandwidth.
- Optional coordinate-search tuning over the main procedure parameters.
- Initialization-versus-final accuracy, per-scale accuracy, AO diagnostics,
  anisotropy and the data-fit statistic.

Because `beta` and `-beta` represent the same index, accuracy is reported as
the sign-invariant alignment

\[
|\widehat\beta^\top \beta^*|.
\]

## Run locally

Prerequisite: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Validate

```bash
npm test
```

The implementation lives primarily in:

- `app/simulation.ts` — simulation and estimator.
- `app/simulation.worker.ts` — background computation.
- `app/page.tsx` — controls and diagnostics.
- `app/globals.css` — responsive presentation.
