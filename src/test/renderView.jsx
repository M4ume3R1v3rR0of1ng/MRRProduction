// src/test/renderView.jsx
//
// Renders a view the way App.jsx does: its data props (jobs, inv, reqs, ...) held
// in real React state and handed down with their setters, inside the
// NotificationProvider that supplies showToast and confirm.
//
// The permission matrix passes a no-op setJobs, which is enough to ask whether a
// button is there. It is not enough to press one: after a transition the view is
// supposed to re-render from the state it just wrote, and a no-op leaves it
// showing the job as it was. Holding the state here lets a test assert on both
// halves — the row the view wrote, and the card it now shows.
//
//   const view = renderStateful(PullInventoryView, {
//     state: { jobs: [job], inv },
//     props: { user, perms, ... },
//   });
//   view.state.jobs  // the latest jobs after whatever the test pressed
import { useState } from "react";
import { render } from "@testing-library/react";
import { NotificationProvider } from "@/shared/context/NotificationContext";

const setterName = (key) => `set${key[0].toUpperCase()}${key.slice(1)}`;

export function renderStateful(View, { state: initial, props = {} }) {
  const latest = { ...initial };

  function Harness() {
    const [state, setState] = useState(initial);
    Object.assign(latest, state);
    const bound = {};
    for (const key of Object.keys(initial)) {
      bound[key] = state[key];
      bound[setterName(key)] = (next) =>
        setState((s) => ({ ...s, [key]: typeof next === "function" ? next(s[key]) : next }));
    }
    return <View {...props} {...bound} />;
  }

  const result = render(
    <NotificationProvider>
      <Harness />
    </NotificationProvider>,
  );
  return { ...result, state: latest };
}
