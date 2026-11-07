package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestWriteJSONAtomicConcurrent(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".publish-status")
	if err := os.WriteFile(path+".tmp", []byte("another writer"), 0644); err != nil {
		t.Fatal(err)
	}
	original, err := os.Stat(path + ".tmp")
	if err != nil {
		t.Fatal(err)
	}
	var writers sync.WaitGroup
	for _, value := range []string{strings.Repeat("a", 8192), strings.Repeat("b", 16384)} {
		writers.Add(1)
		go func(value string) {
			defer writers.Done()
			for i := 0; i < 50; i++ {
				if err := writeJSONAtomic(path, value); err != nil {
					t.Error(err)
					return
				}
				b, err := os.ReadFile(path)
				var got string
				if err != nil || json.Unmarshal(b, &got) != nil ||
					(got != strings.Repeat("a", 8192) && got != strings.Repeat("b", 16384)) {
					t.Errorf("incomplete JSON during concurrent writes: %v", err)
					return
				}
			}
		}(value)
	}
	writers.Wait()
	if b, err := os.ReadFile(path + ".tmp"); err != nil || string(b) != "another writer" {
		t.Fatalf("touched another writer's temporary file: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != original.Mode().Perm() {
		t.Fatalf("incorrect file permissions: %v, %v", info, err)
	}
	assertNoAtomicTemps(t, path)
}

func TestWriteJSONAtomicFailures(t *testing.T) {
	for _, kind := range []string{"marshal", "create", "rename"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "status")
			preserved := path
			var value any = "new"
			switch kind {
			case "marshal":
				value = make(chan int)
			case "create":
				path = filepath.Join(path, "missing", "status")
			case "rename":
				if err := os.Mkdir(path, 0755); err != nil {
					t.Fatal(err)
				}
				preserved = filepath.Join(path, "original")
			}
			if err := os.WriteFile(preserved, []byte(`{"old":true}`), 0644); err != nil {
				t.Fatal(err)
			}
			if err := writeJSONAtomic(path, value); err == nil {
				t.Fatal("expected failure")
			}
			if b, err := os.ReadFile(preserved); err != nil || string(b) != `{"old":true}` {
				t.Fatalf("original content changed: %v", err)
			}
			assertNoAtomicTemps(t, path)
		})
	}
}

func TestWriteJSONAtomicWriteFailure(t *testing.T) {
	if path := os.Getenv("ATOMIC_WRITE_FAILURE_PATH"); path != "" {
		err := writeJSONAtomic(path, strings.Repeat("x", 8192))
		if failure, ok := err.(*os.PathError); !ok || failure.Op != "write" {
			t.Fatalf("expected a write error, got %v", err)
		}
		return
	}
	path := filepath.Join(t.TempDir(), "status")
	if err := os.WriteFile(path, []byte(`{"old":true}`), 0644); err != nil {
		t.Fatal(err)
	}
	// Limit only the child process so a real partial write cannot affect other tests.
	cmd := exec.Command("bash", "-c", `ulimit -f 1; exec "$@"`, "--", os.Args[0], "-test.run=^TestWriteJSONAtomicWriteFailure$")
	cmd.Env = append(os.Environ(), "ATOMIC_WRITE_FAILURE_PATH="+path)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("write failure check: %v\n%s", err, output)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != `{"old":true}` {
		t.Fatalf("original content changed after write failure: %v", err)
	}
	assertNoAtomicTemps(t, path)
}

func assertNoAtomicTemps(t *testing.T, path string) {
	t.Helper()
	files, err := filepath.Glob(path + ".tmp.*")
	if err != nil || len(files) != 0 {
		t.Fatalf("temporary files left behind: %v, %v", files, err)
	}
}
