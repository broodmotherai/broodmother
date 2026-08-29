package task

// RunOrder is the order a run walks the graph: layers of node ids, triggers first, every node
// after everything that feeds it. Nil when the graph has a cycle — the editor refuses the edge
// and the server refuses the run with the same answer.
func RunOrder(t Task) [][]string {
	waiting := make(map[string]int, len(t.Nodes))
	for _, node := range t.Nodes {
		waiting[node.ID] = 0
	}
	for _, edge := range t.Edges {
		waiting[edge.To]++
	}

	var ready []string
	for _, node := range t.Nodes {
		if waiting[node.ID] == 0 {
			ready = append(ready, node.ID)
		}
	}

	var layers [][]string
	placed := 0
	for len(ready) > 0 {
		layers = append(layers, ready)
		placed += len(ready)
		leaving := map[string]bool{}
		for _, id := range ready {
			leaving[id] = true
		}
		var next []string
		for _, edge := range t.Edges {
			if !leaving[edge.From] {
				continue
			}
			waiting[edge.To]--
			if waiting[edge.To] == 0 {
				next = append(next, edge.To)
			}
		}
		ready = next
	}
	if placed != len(t.Nodes) {
		return nil
	}
	return layers
}
