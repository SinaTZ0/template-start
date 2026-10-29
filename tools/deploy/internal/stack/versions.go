package stack

import (
	"encoding/json"
	"strings"
)

/*===== Versions =====*/
// Every build tags the app's image with the commit it was built from (`template-app:381286c`), next to the `latest`
// tag Compose runs. Roll back points `latest` at an older tag and replaces the app with it; the newest KeepVersions
// stay.

// AppImage is the app's image name, as `image:` in compose.prod.yaml sets it, read from Compose's resolved config.
func (s *Stack) AppImage() (string, error) {
	out, err := s.Command(nil, "config", "--format", "json").Output()
	if err != nil {
		return "", err
	}
	var config struct {
		Services map[string]struct {
			Image string `json:"image"`
		} `json:"services"`
	}
	if err := json.Unmarshal(out, &config); err != nil {
		return "", err
	}
	return config.Services["app"].Image, nil
}

// Version is a kept app image: its tag (a commit) and when it was built ("2 days ago").
type Version struct{ Tag, Built string }

// ListVersions lists the kept versions, newest first.
func ListVersions(image string) []Version {
	out, _ := DockerOutput("image", "ls", image, "--format", "{{.Tag}} {{.CreatedSince}}")
	var versions []Version
	for line := range strings.Lines(out) {
		tag, built, _ := strings.Cut(strings.TrimSpace(line), " ")
		if tag != "" && tag != "latest" && tag != "<none>" {
			versions = append(versions, Version{tag, built})
		}
	}
	return versions
}

// RunningVersion is the version the app container runs: the tag of its image, other than `latest`. Empty without a
// container, or for an image built before versions were tagged.
func (s *Stack) RunningVersion() string {
	id := s.ContainerID("app")
	if id == "" {
		return ""
	}
	imageID, _ := DockerOutput("inspect", "-f", "{{.Image}}", id)
	image, _ := DockerOutput("inspect", "-f", "{{.Config.Image}}", id)
	if i := strings.LastIndex(image, ":"); i >= 0 && !strings.Contains(image[i:], "/") {
		image = image[:i]
	}
	out, _ := DockerOutput("image", "ls", image, "--no-trunc", "--format", "{{.ID}} {{.Tag}}")
	for line := range strings.Lines(out) {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == imageID && fields[1] != "latest" && fields[1] != "<none>" {
			return fields[1]
		}
	}
	return ""
}

// ImageID is an image's ID, empty when there's no such image.
func ImageID(ref string) string {
	id, _ := DockerOutput("image", "inspect", "-f", "{{.Id}}", ref)
	return id
}

// PruneVersions removes the tags beyond the newest KeepVersions, never the running one or the one `latest` points at.
// The image goes with its last tag.
func (s *Stack) PruneVersions(image string) {
	running := s.RunningVersion()
	latest := ImageID(image)
	versions := ListVersions(image)
	if len(versions) <= KeepVersions {
		return
	}
	for _, v := range versions[KeepVersions:] {
		if v.Tag == running || ImageID(image+":"+v.Tag) == latest {
			continue
		}
		_ = Docker(nil, "rmi", image+":"+v.Tag).Run()
	}
}
