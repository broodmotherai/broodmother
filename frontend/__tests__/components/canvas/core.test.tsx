import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { emptyCanvas, type Canvas } from '@/src/contracts/canvas/schema'
import { parseCanvas, serializeCanvas } from '@/src/contracts/canvas/codec'
import { createMockClient, type MockClient } from '@/src/services/mock'
import { AppProvider } from '@/state'
import { DocView } from '@/components/doc'

const PATH = 'Shipping.canvas'

/* The world stands 40px right and down of the surface at rest, and jsdom measures every
   box at the origin, so a screen point is a world point plus that offset. */
const OFFSET = 40
const screenOf = (x: number, y: number) => ({ clientX: x + OFFSET, clientY: y + OFFSET })

const box = (id: string, x: number, y: number, text = id) => ({
  id,
  type: 'text' as const,
  text,
  x,
  y,
  width: 160,
  height: 80,
})

async function show(client: MockClient = seeded()) {
  render(
    <AppProvider client={client}>
      <DocView root="project" path={PATH} />
    </AppProvider>,
  )
  await screen.findByRole('application', { name: `canvas ${PATH}` })
  return client
}

function seeded(canvas: Canvas = emptyCanvas()): MockClient {
  return createMockClient({ docs: { [PATH]: serializeCanvas(canvas) } })
}

/** Two shapes side by side, four hundred apart, with a line between them. */
function pair(): Canvas {
  return {
    nodes: [box('node-1', 0, 0, 'Order'), box('node-2', 400, 0, 'Ship')],
    edges: [
      { id: 'edge-1', fromNode: 'node-1', fromSide: 'right', toNode: 'node-2', toSide: 'left' },
    ],
  }
}

async function saved(client: MockClient): Promise<string> {
  const { markdown } = await client.request('GET /api/doc', { root: 'project', path: PATH })
  return markdown
}

const surface = () => screen.getByRole('application', { name: `canvas ${PATH}` })

const settles = { timeout: 2000 }

/** Opens the toolbar's plus and takes a shape off it. */
async function addShape(label: string) {
  await userEvent.click(screen.getByRole('button', { name: 'add shape' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: label }))
}

/** Opens one of the inspector's colour buttons and spells a hex into it. */
async function pick(label: string, hex: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }))
  const field = await screen.findByLabelText('Hex')
  await userEvent.clear(field)
  await userEvent.type(field, `${hex}{Enter}`)
  await userEvent.keyboard('{Escape}')
}

it('draws the shapes and the lines the file describes', async () => {
  await show(seeded(pair()))
  expect(screen.getByRole('group', { name: 'Order' })).toHaveAttribute(
    'data-shape',
    'rectangle',
  )
  expect(screen.getByRole('group', { name: 'Ship' })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Order to Ship' })).toBeInTheDocument()
})

it('shows a broken diagram its parse error', async () => {
  const client = createMockClient({ docs: { [PATH]: '{"nodes":[{"id":"a","type":"group"}]}' } })
  render(
    <AppProvider client={client}>
      <DocView root="project" path={PATH} />
    </AppProvider>,
  )
  await screen.findByText(/cannot draw yet/)
})

it('adds a shape from the toolbar and saves it back as canonical JSON', async () => {
  const client = await show()
  await addShape('Ellipse')
  await waitFor(async () => expect(await saved(client)).toContain('ellipse'), settles)
  const canvas = parseCanvas(await saved(client))
  expect(canvas.nodes).toHaveLength(1)
  // A shape arrives named for what it is, rather than as a blank you have to fill in.
  expect(canvas.nodes[0]).toMatchObject({
    type: 'text',
    shape: 'ellipse',
    text: 'Ellipse',
  })
})

/* A rectangle is what a shape is when nothing says otherwise, so the file says nothing. */
it('leaves the plainest shape unsaid in the file', async () => {
  const client = await show()
  await addShape('Rectangle')
  await waitFor(async () => expect(await saved(client)).toContain('node-1'), settles)
  expect(await saved(client)).not.toContain('shape')
})

it('adds a shape where the plane was right-clicked', async () => {
  const client = await show()
  fireEvent.contextMenu(surface(), { clientX: 300, clientY: 200 })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Diamond' }))
  await waitFor(async () => expect(await saved(client)).toContain('diamond'), settles)
  // The pointer stood at world (260, 160); a 176×112 diamond centres on it, then snaps.
  expect(parseCanvas(await saved(client)).nodes[0]).toMatchObject({ x: 176, y: 112 })
})

/* Double-clicking bare plane is how a diagram starts: a box where you pointed, already
   taking what you type. */
it('makes a box on a double click, with the inspector open on its words', async () => {
  const client = await show()
  fireEvent.doubleClick(surface(), screenOf(200, 100))
  const text = await screen.findByLabelText('Text')
  expect(text).toHaveValue('Rectangle')
  await userEvent.clear(text)
  await userEvent.type(text, 'Warehouse')
  await waitFor(async () => expect(await saved(client)).toContain('Warehouse'), settles)
  expect(screen.getByRole('group', { name: 'Warehouse' })).toBeInTheDocument()
})

/* Words are written in the one place they are written: a shape on the canvas is a picture
   of what the file says, not a field. */
it('opens no field on the canvas itself', async () => {
  await show(seeded(pair()))
  const node = screen.getByRole('group', { name: 'Order' })
  await userEvent.dblClick(node)
  expect(screen.queryByRole('textbox', { name: 'Shape text' })).not.toBeInTheDocument()
  const line = screen.getByRole('group', { name: 'Order to Ship' })
  await userEvent.dblClick(line.querySelector('.canvas-edge-hit')!)
  expect(screen.queryByRole('textbox', { name: 'Line label' })).not.toBeInTheDocument()
})

it('walks a shape along the grid as it is dragged', async () => {
  const client = await show(seeded(pair()))
  const node = screen.getByRole('group', { name: 'Order' })
  fireEvent.pointerDown(node, { button: 0, ...screenOf(80, 40) })
  fireEvent.pointerMove(window, screenOf(80 + 70, 40 + 30))
  fireEvent.pointerUp(window, screenOf(80 + 70, 40 + 30))
  await waitFor(async () => expect(await saved(client)).toContain('"x": 64'), settles)
  expect(parseCanvas(await saved(client)).nodes[0]).toMatchObject({ x: 64, y: 32 })
})

it('takes a whole selection with the shape that is dragged', async () => {
  const client = await show(seeded(pair()))
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Order' }), { button: 0 })
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Ship' }), {
    button: 0,
    shiftKey: true,
  })
  const node = screen.getByRole('group', { name: 'Order' })
  fireEvent.pointerDown(node, { button: 0, ...screenOf(80, 40) })
  fireEvent.pointerMove(window, screenOf(80 + 32, 40))
  fireEvent.pointerUp(window, screenOf(80 + 32, 40))
  await waitFor(async () => expect(await saved(client)).toContain('"x": 32'), settles)
  const canvas = parseCanvas(await saved(client))
  expect(canvas.nodes.map((one) => one.x)).toEqual([32, 432])
})

it('resizes from a corner, holding the corner opposite still', async () => {
  const client = await show(seeded(pair()))
  const node = screen.getByRole('group', { name: 'Order' })
  fireEvent.pointerDown(node, { button: 0 })
  const handle = node.querySelector('[data-corner="se"]')!
  fireEvent.pointerDown(handle, { button: 0, ...screenOf(160, 80) })
  fireEvent.pointerMove(window, screenOf(160 + 32, 80 + 16))
  fireEvent.pointerUp(window, screenOf(160 + 32, 80 + 16))
  await waitFor(async () => expect(await saved(client)).toContain('"width": 192'), settles)
  expect(parseCanvas(await saved(client)).nodes[0]).toMatchObject({
    x: 0,
    y: 0,
    width: 192,
    height: 96,
  })
})

/* Handles are for a shape picked by itself: a handle on every shape in a selection is
   more argument than help. */
it('shows corner handles only on a shape picked alone', async () => {
  await show(seeded(pair()))
  const node = screen.getByRole('group', { name: 'Order' })
  fireEvent.pointerDown(node, { button: 0 })
  expect(node.querySelectorAll('[data-corner]')).toHaveLength(4)
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Ship' }), {
    button: 0,
    shiftKey: true,
  })
  expect(node.querySelectorAll('[data-corner]')).toHaveLength(0)
})

it('draws a line from a port to the port it takes hold of', async () => {
  const client = await show(
    seeded({ nodes: [box('node-1', 0, 0, 'Order'), box('node-2', 400, 0, 'Ship')], edges: [] }),
  )
  const from = screen.getByRole('group', { name: 'Order' })
  const port = from.querySelector('[data-side="right"]')!
  fireEvent.pointerDown(port, { button: 0, ...screenOf(160, 40) })
  fireEvent.pointerMove(window, screenOf(396, 40))
  fireEvent.pointerUp(window, screenOf(396, 40))
  await waitFor(async () => expect(await saved(client)).toContain('edge-1'), settles)
  expect(parseCanvas(await saved(client)).edges[0]).toEqual({
    id: 'edge-1',
    fromNode: 'node-1',
    fromSide: 'right',
    toNode: 'node-2',
    toSide: 'left',
  })
  expect(screen.getByRole('group', { name: 'Order to Ship' })).toBeInTheDocument()
})

/* Short of a port, a line dropped anywhere on a shape still means that shape — on the
   side facing where the line came from. */
it('lands a line dropped on the body of a shape', async () => {
  const client = await show(
    seeded({ nodes: [box('node-1', 0, 0, 'Order'), box('node-2', 400, 0, 'Ship')], edges: [] }),
  )
  const port = screen.getByRole('group', { name: 'Order' }).querySelector('[data-side="right"]')!
  fireEvent.pointerDown(port, { button: 0, ...screenOf(160, 40) })
  fireEvent.pointerMove(window, screenOf(560, 40))
  fireEvent.pointerUp(window, screenOf(560, 40))
  await waitFor(async () => expect(await saved(client)).toContain('edge-1'), settles)
  expect(parseCanvas(await saved(client)).edges[0]).toMatchObject({ toSide: 'right' })
})

it('deletes what is picked, and the lines that had hold of it', async () => {
  const client = await show(seeded(pair()))
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Order' }), { button: 0 })
  fireEvent.keyDown(surface(), { key: 'Backspace' })
  await waitFor(async () => expect(await saved(client)).not.toContain('Order'), settles)
  const canvas = parseCanvas(await saved(client))
  expect(canvas.nodes.map((one) => one.text)).toEqual(['Ship'])
  expect(canvas.edges).toEqual([])
})

it('picks a line, and deletes it without touching the shapes', async () => {
  const client = await show(seeded(pair()))
  const line = screen.getByRole('group', { name: 'Order to Ship' })
  fireEvent.pointerDown(line.querySelector('.canvas-edge-hit')!, { button: 0 })
  fireEvent.keyDown(surface(), { key: 'Backspace' })
  await waitFor(async () => expect(await saved(client)).not.toContain('edge-1'), settles)
  expect(parseCanvas(await saved(client)).nodes).toHaveLength(2)
})

it('gathers shapes with a rubber band', async () => {
  await show(seeded(pair()))
  fireEvent.pointerDown(surface(), { button: 0, shiftKey: true, ...screenOf(-20, -20) })
  fireEvent.pointerMove(window, screenOf(600, 200))
  fireEvent.pointerUp(window, screenOf(600, 200))
  expect(
    within(screen.getByRole('region', { name: 'shape options' })).getByText('2 shapes'),
  ).toBeInTheDocument()
})

it('changes a shape from the inspector', async () => {
  const client = await show(seeded(pair()))
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Order' }), { button: 0 })
  await userEvent.click(await screen.findByRole('radio', { name: 'Diamond' }))
  await waitFor(async () => expect(await saved(client)).toContain('diamond'), settles)
})

/* A shape is a white card with a grey line round it until it is told otherwise, and it is
   told on the app's own picker — with nothing suggested in front of it, because there is no
   colour we would pick for you here. */
it('fills a shape and lines it from the colour pickers', async () => {
  const client = await show(seeded(pair()))
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Order' }), { button: 0 })

  await pick('Fill', '34d399')
  await waitFor(async () => expect(await saved(client)).toContain('"fill": "#34d399"'), settles)

  await pick('Border', 'f472b6')
  await waitFor(async () => expect(await saved(client)).toContain('"color": "#f472b6"'), settles)

  // Words over a light fill are dark, so nothing a shape is filled with hides them.
  expect(screen.getByRole('group', { name: 'Order' })).toHaveStyle({ '--ink': '#111111' })
})

/* One button, wearing the colour it holds — the palette every other picker in the app
   leads with is a row of wrong answers on a diagram. */
it('offers no palette in front of the picker', async () => {
  await show(seeded(pair()))
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Order' }), { button: 0 })
  await screen.findByRole('button', { name: 'Fill' })
  expect(screen.queryByRole('radio', { name: /opal/ })).not.toBeInTheDocument()
})

/* A text box has no card to fill — only the ink its words are written in, which starts
   light because the board it stands on is dark. */
it('asks a text box for its ink and nothing else', async () => {
  const client = await show(
    seeded({
      nodes: [{ ...box('node-1', 0, 0, 'A note'), shape: 'text' as const }],
      edges: [],
    }),
  )
  fireEvent.pointerDown(screen.getByRole('group', { name: 'A note' }), { button: 0 })
  expect(await screen.findByRole('button', { name: 'Ink' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Fill' })).not.toBeInTheDocument()
  await pick('Ink', '22d3ee')
  await waitFor(async () => expect(await saved(client)).toContain('"color": "#22d3ee"'), settles)
})

/* Nothing said about a shape is nothing written down: a diagram of plain white cards is a
   file of plain nodes, and every other canvas reader draws it the same. */
it('leaves the colours it was never asked about out of the file', async () => {
  const client = await show()
  await addShape('Rectangle')
  await waitFor(async () => expect(await saved(client)).toContain('node-1'), settles)
  expect(await saved(client)).not.toContain('fill')
  expect(await saved(client)).not.toContain('color')
})

it('writes a shape’s words from the inspector too', async () => {
  const client = await show(seeded(pair()))
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Order' }), { button: 0 })
  const text = await screen.findByLabelText('Text')
  await userEvent.clear(text)
  await userEvent.type(text, 'Order taken')
  await waitFor(async () => expect(await saved(client)).toContain('Order taken'), settles)
})

it('labels a line from the inspector, and takes its arrow off', async () => {
  const client = await show(seeded(pair()))
  const line = screen.getByRole('group', { name: 'Order to Ship' })
  fireEvent.pointerDown(line.querySelector('.canvas-edge-hit')!, { button: 0 })
  await userEvent.type(await screen.findByLabelText('Label'), 'when paid')
  await waitFor(async () => expect(await saved(client)).toContain('"label": "when paid"'), settles)
  expect(screen.getByText('when paid')).toHaveClass('canvas-label')

  await userEvent.click(await screen.findByRole('checkbox', { name: 'At the end' }))
  await waitFor(async () => expect(await saved(client)).toContain('"toEnd": "none"'), settles)
})

/* The bottom panel is the diagram's own here — ⌘J raises and lowers it the way it does the
   terminal everywhere else, and it stands empty until something is picked. */
it('toggles the options panel with ⌘J', async () => {
  await show(seeded(pair()))
  expect(screen.queryByRole('region', { name: 'shape options' })).not.toBeInTheDocument()
  await userEvent.keyboard('{Meta>}j{/Meta}')
  expect(screen.getByText(/pick a shape or a line/i)).toBeInTheDocument()
  await userEvent.keyboard('{Meta>}j{/Meta}')
  expect(screen.queryByRole('region', { name: 'shape options' })).not.toBeInTheDocument()
})

it('copies what is picked and pastes it a step down and to the right', async () => {
  const client = await show(seeded(pair()))
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Order' }), { button: 0 })
  await userEvent.keyboard('{Meta>}c{/Meta}')
  await userEvent.keyboard('{Meta>}v{/Meta}')
  await waitFor(async () => expect(await saved(client)).toContain('node-3'), settles)
  const canvas = parseCanvas(await saved(client))
  expect(canvas.nodes).toHaveLength(3)
  expect(canvas.nodes[2]).toMatchObject({ id: 'node-3', x: 32, y: 32, text: 'Order' })
})

it('takes everything on the plane with ⌘A', async () => {
  await show(seeded(pair()))
  surface().focus()
  await userEvent.keyboard('{Meta>}a{/Meta}')
  expect(
    within(screen.getByRole('region', { name: 'shape options' })).getByText('2 shapes'),
  ).toBeInTheDocument()
})

/* The rectangle is drawn with its corners off, and there is only one of it: the shape that
   used to stand beside it, square-cornered, is gone. */
it('offers one rectangle, and the family Lucid draws a flow with', async () => {
  await show()
  await userEvent.click(screen.getByRole('button', { name: 'add shape' }))
  const menu = await screen.findByRole('menu')
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual([
    'Rectangle',
    'Terminator',
    'Trigger',
    'Ellipse',
    'Diamond',
    'Document',
    'Multiple Documents',
    'Cloud',
    'Class',
    'Text box',
  ])
})

it('draws the terminator as a pill and the trigger with one end rounded whole', async () => {
  await show(
    seeded({
      nodes: [
        { ...box('node-1', 0, 0, 'Start'), shape: 'terminator' as const },
        { ...box('node-2', 240, 0, 'On push'), shape: 'trigger' as const },
      ],
      edges: [],
    }),
  )
  // A pill is the card with its ends taken off whole — half its height, each side.
  const pill = screen.getByRole('group', { name: 'Start' }).querySelector('rect')!
  expect(pill).toHaveAttribute('rx', '39')
  // The trigger is a path, because no rectangle rounds one end and not the other.
  const trigger = screen.getByRole('group', { name: 'On push' })
  expect(trigger.querySelector('path')).toBeInTheDocument()
  expect(trigger.querySelector('rect')).not.toBeInTheDocument()
})

/* A port with a line on it is not drawn: the line already says what the circle would. */
it('takes the port away from a side a line is already on', async () => {
  await show(seeded(pair()))
  const from = screen.getByRole('group', { name: 'Order' })
  expect(from.querySelector('[data-side="right"]')).not.toBeInTheDocument()
  expect(from.querySelector('[data-side="left"]')).toBeInTheDocument()
  const to = screen.getByRole('group', { name: 'Ship' })
  expect(to.querySelector('[data-side="left"]')).not.toBeInTheDocument()
  expect(to.querySelector('[data-side="right"]')).toBeInTheDocument()
})

/* A class box is a text node like any other — the compartments are rules written into the
   text, so the file stays something any canvas can open. */
it('adds a UML class, and draws it in its compartments', async () => {
  const client = await show()
  await addShape('Class')
  await waitFor(async () => expect(await saved(client)).toContain('ClassName'), settles)
  expect(parseCanvas(await saved(client)).nodes[0]).toMatchObject({
    shape: 'class',
    text: 'ClassName\n---\n- field: Type',
  })

  // It answers to its class name, not to the whole of what is written in it.
  const node = screen.getByRole('group', { name: 'ClassName' })
  expect(node.querySelector('.canvas-class-name')).toHaveTextContent('ClassName')
  expect(node.querySelectorAll('.canvas-class-part')).toHaveLength(1)
  expect(node.querySelectorAll('.canvas-class-part')[0]).toHaveTextContent('- field: Type')
})

it('gives a class a field to a compartment, and no Text field', async () => {
  await show()
  await addShape('Class')
  expect(await screen.findByLabelText('Class Name')).toHaveValue('ClassName')
  expect(screen.getByLabelText('Compartment 1')).toHaveValue('- field: Type')
  expect(screen.queryByLabelText('Compartment 2')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Text')).not.toBeInTheDocument()
})

/* Reaching for a shape and letting go just short of it used to drop the line on the floor:
   a line was only taken by a port it had hold of, or by a shape the pointer was inside, and
   between those two there was a ring round every shape where nothing happened. */
it('lands a line let go of near a shape, not only on one', async () => {
  const client = await show(
    seeded({ nodes: [box('node-1', 0, 0, 'Order'), box('node-2', 400, 0, 'Ship')], edges: [] }),
  )
  const port = screen.getByRole('group', { name: 'Order' }).querySelector('[data-side="right"]')!
  fireEvent.pointerDown(port, { button: 0, ...screenOf(160, 40) })
  // Fifty out from the left port: too far to have taken hold, and outside the shape.
  fireEvent.pointerMove(window, screenOf(370, 0))
  fireEvent.pointerUp(window, screenOf(370, 0))
  await waitFor(async () => expect(await saved(client)).toContain('edge-1'), settles)
  expect(parseCanvas(await saved(client)).edges[0]).toMatchObject({
    fromNode: 'node-1',
    toNode: 'node-2',
    toSide: 'left',
  })
})

/* Two shapes can be joined more than once — a class diagram says several things about the
   same pair — so long as no two lines leave and land in exactly the same place. */
it('draws a second line between the same two shapes from another side', async () => {
  const client = await show(seeded(pair()))
  const port = screen.getByRole('group', { name: 'Order' }).querySelector('[data-side="bottom"]')!
  fireEvent.pointerDown(port, { button: 0, ...screenOf(80, 80) })
  fireEvent.pointerMove(window, screenOf(480, 80))
  fireEvent.pointerUp(window, screenOf(480, 80))
  await waitFor(async () => expect(await saved(client)).toContain('edge-2'), settles)
  const edges = parseCanvas(await saved(client)).edges
  expect(edges).toHaveLength(2)
  expect(edges[1]).toMatchObject({ fromSide: 'bottom', toSide: 'bottom' })
})

/* Each compartment is its own field: a double click lands in the one you pointed at rather
   than in the whole box, and the box grows by the lines put into it. */
it('edits one compartment of a class, and grows the box by what is written', async () => {
  const client = await show()
  await addShape('Class')
  await waitFor(async () => expect(await saved(client)).toContain('ClassName'), settles)
  const tall = parseCanvas(await saved(client)).nodes[0].height

  const field = await screen.findByLabelText('Compartment 1')
  await userEvent.clear(field)
  await userEvent.type(field, '- id: string{Enter}- name: string')

  await waitFor(async () => expect(await saved(client)).toContain('- name: string'), settles)
  const written = parseCanvas(await saved(client)).nodes[0]
  // The name is as it was, and the box has grown to hold the new line.
  expect(written.text).toBe('ClassName\n---\n- id: string\n- name: string')
  expect(written.height).toBeGreaterThan(tall)
  expect(written.height % 16).toBe(0)
})

it('renames a class from its name field', async () => {
  const client = await show()
  await addShape('Class')
  const field = await screen.findByLabelText('Class Name')
  await userEvent.clear(field)
  await userEvent.type(field, 'Order')
  await waitFor(async () => expect(await saved(client)).toContain('Order\\n---'), settles)
  expect(screen.getByRole('group', { name: 'Order' })).toBeInTheDocument()
})

/* Sizes are said in cells, because the grid is what a shape walks and snaps to. */
it('measures a shape in cells rather than in pixels', async () => {
  const client = await show(seeded(pair()))
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Order' }), { button: 0 })
  const width = await screen.findByLabelText('Width (Cells)')
  // A hundred and sixty pixels is ten cells of sixteen.
  expect(width).toHaveValue(10)
  fireEvent.change(width, { target: { value: '12' } })
  await waitFor(async () => expect(await saved(client)).toContain('"width": 192'), settles)
  // And the height with it, in the same unit.
  fireEvent.change(screen.getByLabelText('Height (Cells)'), { target: { value: '3' } })
  await waitFor(async () => expect(await saved(client)).toContain('"height": 48'), settles)
})

it('draws a document with a wave, a stack as three, and a cloud', async () => {
  await show(
    seeded({
      nodes: [
        { ...box('node-1', 0, 0, 'Invoice'), shape: 'document' as const },
        { ...box('node-2', 240, 0, 'Records'), shape: 'documents' as const },
        { ...box('node-3', 480, 0, 'Internet'), shape: 'cloud' as const },
      ],
      edges: [],
    }),
  )
  const page = screen.getByRole('group', { name: 'Invoice' }).querySelector('path')!
  expect(page.getAttribute('d')).toContain('Q')
  expect(
    screen.getByRole('group', { name: 'Records' }).querySelectorAll('path'),
  ).toHaveLength(3)
  expect(
    screen.getByRole('group', { name: 'Internet' }).querySelector('path')!.getAttribute('d'),
  ).toMatch(/^M .* C .* Z$/)
})
