// How a document is addressed is vocabulary the browser shares. In the daemon these live
// beside the code that reads the disk and are re-exported from `tree`; nothing that reads a
// disk can be bundled for a browser, so this side re-exports them from the contract instead.
// A tree and the addresses it takes are still one idea to callers.
export type { DocPath, DocRef, DocRoot, TreeEntry, TreeEvent } from '@/src/contracts/doc'
export { repoOf, repoRoot } from '@/src/contracts/doc'
