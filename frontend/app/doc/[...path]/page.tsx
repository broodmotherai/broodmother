import type { DocRoot } from '@/src/contracts/doc'
import { DocView } from '@/components/doc'
import { HomeView } from '@/components/doc'

/** Next hands catch-all segments as they appear in the URL, so a document with a space in
 *  its name arrives as `The%20Journey.md` and reaches the server — and `open()` — that
 *  way. A malformed escape is passed through rather than thrown on: the tree then
 *  answers "no such document", which is the truth. */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

const isRoot = (value: string): value is DocRoot =>
  value === 'project' || /^repo:.+$/.test(value)

/** `/doc/<root>/<path>`: the first segment names which tree, because a path on its own
 *  stopped being an address the moment a project could link more than one repository. */
export default async function Page({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const [root, ...rest] = path.map(decode)
  if (!root || !isRoot(root) || rest.length === 0) return <HomeView />
  return <DocView root={root} path={rest.join('/')} />
}
