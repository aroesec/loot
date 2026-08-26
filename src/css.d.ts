/*
 * Side-effect imports of stylesheets.
 *
 * `import "./globals.css"` has no type declaration of its own, and TypeScript 7
 * rejects a side-effect import it cannot resolve to a module (TS2882) where 5.x
 * quietly allowed it. Next.js supplies `next-env.d.ts`, but that does not cover
 * this case.
 *
 * These are declared as `unknown` rather than `any` so that anything actually
 * reading from a stylesheet import has to say what it expects. Nothing here
 * does: Tailwind is applied through class names, not through the module.
 */
declare module "*.css" {
  const stylesheet: unknown;
  export default stylesheet;
}
