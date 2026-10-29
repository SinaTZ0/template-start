package certs

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type issued struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
}

// issue makes a certificate signed by parent (self-signed when parent is nil).
func issue(t *testing.T, name string, ca bool, dns []string, parent *issued) issued {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: name}, DNSNames: dns,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(90 * 24 * time.Hour),
		IsCA: ca, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
	}
	signer, signerKey := tmpl, key
	if parent != nil {
		signer, signerKey = parent.cert, parent.key
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, signer, &key.PublicKey, signerKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	return issued{cert, key}
}

func writePEM(t *testing.T, path, kind string, der []byte) {
	t.Helper()
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestInstallFindsTheMatchingKeyAndChain(t *testing.T) {
	root := issue(t, "Test Root", true, nil, nil)
	intermediate := issue(t, "Test Intermediate", true, nil, &root)
	leaf := issue(t, "app.test", false, []string{"app.test", "*.app.test"}, &intermediate)
	other := issue(t, "other", false, []string{"app.test", "*.app.test"}, &intermediate)

	folder, out := t.TempDir(), filepath.Join(t.TempDir(), "certs")
	writePEM(t, filepath.Join(folder, "app.crt"), "CERTIFICATE", leaf.cert.Raw)
	writePEM(t, filepath.Join(folder, "chain.pem"), "CERTIFICATE", intermediate.cert.Raw)
	writePEM(t, filepath.Join(folder, "root.cer"), "CERTIFICATE", root.cert.Raw)
	// A key that belongs to another certificate must not be picked.
	otherKey, _ := x509.MarshalECPrivateKey(other.key)
	writePEM(t, filepath.Join(folder, "old.key"), "EC PRIVATE KEY", otherKey)
	key, _ := x509.MarshalPKCS8PrivateKey(leaf.key)
	writePEM(t, filepath.Join(folder, "app.key"), "PRIVATE KEY", key)

	// errors.app.test is one level under the wildcard; Install confirms its summary itself without a terminal.
	if err := Install(folder, "app.test", "errors.app.test", out); err != nil {
		t.Fatalf("Install: %v", err)
	}
	fullchain, _ := os.ReadFile(filepath.Join(out, "fullchain.pem"))
	if n := strings.Count(string(fullchain), "BEGIN CERTIFICATE"); n != 2 {
		t.Errorf("fullchain.pem holds %d certificates, want the leaf and the intermediate (no root)", n)
	}
	if info, _ := os.Stat(filepath.Join(out, "key.pem")); info == nil || info.Mode().Perm() != 0o600 {
		t.Error("key.pem missing or readable by others")
	}
}

func TestInstallRefusesADomainTheCertificateDoesntCover(t *testing.T) {
	root := issue(t, "Test Root", true, nil, nil)
	leaf := issue(t, "app.test", false, []string{"app.test", "*.app.test"}, &root)
	folder := t.TempDir()
	writePEM(t, filepath.Join(folder, "app.crt"), "CERTIFICATE", leaf.cert.Raw)
	key, _ := x509.MarshalPKCS8PrivateKey(leaf.key)
	writePEM(t, filepath.Join(folder, "app.key"), "PRIVATE KEY", key)

	// A wildcard covers one level only.
	err := Install(folder, "app.test", "a.errors.app.test", filepath.Join(t.TempDir(), "certs"))
	if err == nil || !strings.Contains(err.Error(), "not a.errors.app.test") {
		t.Errorf("Install = %v, want a refusal naming a.errors.app.test", err)
	}
}
