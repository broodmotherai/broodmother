package constants

const (
	ReposDir       = ".repos"
	ToolsDir       = ".tools"
	SkillsDir      = ".tools/.skills"
	PersonasDir    = ".personas"
	TasksDir       = ".tasks"
	AttachmentsDir = ".attachments"
	ProfileFile    = "profile.json"

	// Primary is the checkout a root is opened on before any branch is cut.
	Primary = "local"

	TempSuffix = ".broodmothertmp"
)

// Reserved names a document may not take, because the folders behind them are not documents.
// Everything else starting with a dot is a document like any other — hidden from Finder, not
// from the app that edits it.
var Reserved = map[string]bool{".git": true, ".broodmother": true, ReposDir: true}

func IsReserved(segment string) bool {
	return Reserved[segment]
}
