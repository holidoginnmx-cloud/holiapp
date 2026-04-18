// React DOM shim for React Native
// @clerk/clerk-react imports react-dom for web portal support which is not needed on native
const React = require("react");

module.exports = {
  createPortal: (children) => children,
  render: () => {},
  unmountComponentAtNode: () => false,
  findDOMNode: () => null,
  flushSync: (fn) => fn(),
  unstable_batchedUpdates: (fn) => fn(),
};
