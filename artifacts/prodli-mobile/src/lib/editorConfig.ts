// Settings the phone's note editor shares with the computer's (artifacts/prodli
// sections/editor/extensions.ts), so a note saved on the phone has the same HTML.
// Plain data and a pure helper: tests use them with TenTap's source too.

/** Links open in a new tab; same attributes as the note editor's links. */
export const PHONE_LINK_ATTRIBUTES = { target: "_blank", rel: "noopener noreferrer" } as const;

type Bridge = { name: string };
type LinkBridgeLike<B extends Bridge> = { configureExtension(options: { HTMLAttributes: typeof PHONE_LINK_ATTRIBUTES }): B };

/**
 * The native side's bridges: TenTap's start kit without its image bridge (ProdLi's
 * picture node takes the "image" name in the editor bundle, editor-web/main.tsx) and
 * with links written like the computer's.
 */
export function phoneBridgeList<B extends Bridge>(startKit: readonly B[], linkBridge: LinkBridgeLike<B>): B[] {
  return [...startKit.filter((b) => b.name !== "image" && b.name !== "link"), linkBridge.configureExtension({ HTMLAttributes: PHONE_LINK_ATTRIBUTES })];
}
