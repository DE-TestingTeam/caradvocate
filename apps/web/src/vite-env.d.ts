/**
 * Vite's ambient types, which is what makes `import logo from './logo.png'` typecheck.
 *
 * The app had no asset imports until now -- everything was JSX and CSS -- so this had never
 * been needed. Without it TypeScript reports "Cannot find module" for any image, font or `?url`
 * import, while Vite itself resolves them fine, so the build fails at the typecheck step for a
 * file that is genuinely there.
 */
/// <reference types="vite/client" />
