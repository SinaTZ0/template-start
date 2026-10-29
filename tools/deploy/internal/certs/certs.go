// Package certs installs your own certificate: it finds the certificate, its key and its intermediates among the files
// in a folder, checks them, and copies them to `certs/` as `fullchain.pem` and `key.pem`, which Caddy reads with
// TLS_MODE=files. Files are recognized by their contents, not their names, since certificate folders come in every
// layout. The original files are never changed.
package certs

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"deploy/internal/project"
	"deploy/internal/ui"
)

// cert is a certificate and the file it came from.
type cert struct {
	*x509.Certificate
	source string
}

// key is a private key and the file it came from.
type key struct {
	signer crypto.Signer
	source string
}

// Install checks the certificate files in folder against both domains and, once the operator confirms the summary,
// copies them into certDir.
func Install(folder, domain, errorsDomain, certDir string) error {
	folder = strings.TrimSuffix(project.ExpandHome(folder), "/")
	if info, err := os.Stat(folder); err != nil || !info.IsDir() {
		return ui.Fail("%s isn't a folder.", folder)
	}
	rel := func(path string) string { return strings.TrimPrefix(path, folder+"/") }

	/*------ Read Every File ------*/
	files, err := candidates(folder, ".crt", ".pem", ".cer", ".key")
	if err != nil {
		return err
	}
	var certs []cert
	var keys []key
	for _, path := range files {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		switch {
		case bytes.Contains(data, []byte("ENCRYPTED PRIVATE KEY")) || bytes.Contains(data, []byte("Proc-Type: 4,ENCRYPTED")):
			ui.Warn("%s is a password-protected key. Decrypt it first: openssl pkey -in <file> -out key.pem", rel(path))
		case bytes.Contains(data, []byte("PRIVATE KEY-----")):
			if signer := parseKey(data); signer != nil {
				keys = append(keys, key{signer, path})
			}
		default:
			for _, c := range parseCerts(data) {
				certs = append(certs, cert{c, path})
			}
		}
	}

	if len(certs) == 0 {
		if pfx, _ := candidates(folder, ".pfx", ".p12"); len(pfx) > 0 {
			return ui.Fail("No .crt, .pem or .cer certificates in %s, only a .pfx. Export them from it first:\n"+
				"  openssl pkcs12 -in <file>.pfx -nokeys -out certificate.pem\n"+
				"  openssl pkcs12 -in <file>.pfx -nocerts -nodes -out key.pem", folder)
		}
		return ui.Fail("No certificates in %s (looked at .crt, .pem, .cer and .key files).", folder)
	}

	/*------ The Certificate ------*/
	// A non-CA certificate for the domain with its key here. With several (an old and a renewed one), the one that
	// expires last.
	var leaf *cert
	var leafKey *key
	covering := 0
	for i := range certs {
		c := &certs[i]
		if c.IsCA || c.VerifyHostname(domain) != nil {
			continue
		}
		covering++
		for j := range keys {
			if samePublicKey(c.PublicKey, keys[j].signer.Public()) && (leaf == nil || c.NotAfter.After(leaf.NotAfter)) {
				leaf, leafKey = c, &keys[j]
			}
		}
	}
	if leaf == nil {
		if covering > 0 {
			return ui.Fail("Found a certificate for %s, but no private key in %s that matches it.", domain, folder)
		}
		ui.Warn("None of the certificates in %s covers %s. They cover:", folder, domain)
		for _, c := range certs {
			if !c.IsCA {
				fmt.Fprintf(ui.Err, "  %s: %s\n", rel(c.source), strings.Join(c.DNSNames, ", "))
			}
		}
		return ui.Fail("No certificate for %s.", domain)
	}

	/*------ Checks ------*/
	if leaf.VerifyHostname(errorsDomain) != nil {
		return ui.Fail("The certificate covers %s, but not %s. A wildcard covers one level only.",
			strings.Join(leaf.DNSNames, ", "), errorsDomain)
	}
	now := time.Now()
	if !leaf.NotAfter.After(now) {
		return ui.Fail("The certificate expired on %s.", leaf.NotAfter.Local().Format(time.DateOnly))
	}
	days := int(leaf.NotAfter.Sub(now).Hours() / 24)

	/*------ Intermediates ------*/
	chain := Chain(leaf.Certificate, plain(certs))
	if len(chain) == 0 {
		ui.Warn("No intermediate certificate for it in %s (its issuer: %s).", folder, leaf.Issuer)
		ui.Warn("Without one, some browsers and the app's error reporting reject the connection.")
		ok, err := ui.Confirm("Use the certificate without it anyway?", false)
		if err != nil {
			return err
		}
		if !ok {
			return ui.Fail("Nothing copied. Add the issuer's intermediate to %s.", folder)
		}
	} else {
		current := leaf.Certificate
		for _, next := range chain {
			if current.CheckSignatureFrom(next) != nil {
				return ui.Fail("The intermediate certificates don't verify the certificate.")
			}
			current = next
		}
	}

	/*------ Summary ------*/
	// A chain certificate named like a root is a cross-sign: the root, signed by an older root, for older clients.
	ui.Info("")
	ui.Info("  Found:")
	ui.Info("    %-13s %-30s %s", "certificate", rel(leaf.source), strings.Join(leaf.DNSNames, ", "))
	ui.Info("    %-13s %-30s %s", "key", rel(leafKey.source), "matches the certificate ✓")
	for _, c := range chain {
		role, source := "intermediate", ""
		for _, other := range certs {
			if other.Certificate == c {
				source = other.source
			}
			if bytes.Equal(other.RawSubject, c.RawSubject) && bytes.Equal(other.RawIssuer, c.RawSubject) {
				role = "cross-sign"
			}
		}
		ui.Info("    %-13s %-30s %s ✓", role, rel(source), c.Subject.CommonName)
	}
	ui.Info("  Covers %s ✓  %s ✓", domain, errorsDomain)
	ui.Info("  Expires %s (%d days)", leaf.NotAfter.Local().Format(time.DateOnly), days)
	if days < 30 {
		ui.Warn("It expires in under 30 days. Caddy can't renew your own certificate: replace it in time.")
	}
	ui.Info("")
	ok, err := ui.Confirm("Use these?", true)
	if err != nil {
		return err
	}
	if !ok {
		return ui.Fail("Nothing copied.")
	}

	/*------ Copy ------*/
	return write(certDir, leaf.Certificate, chain, leafKey.signer)
}

// Chain follows the issuers up from the leaf, at most four steps. Roots (self-signed) are left out: browsers already
// have them, and sending one only adds bytes.
func Chain(leaf *x509.Certificate, pool []*x509.Certificate) []*x509.Certificate {
	var chain []*x509.Certificate
	current := leaf
	for range 4 {
		if bytes.Equal(current.RawIssuer, current.RawSubject) {
			break
		}
		var next *x509.Certificate
		for _, c := range pool {
			if bytes.Equal(c.RawSubject, current.RawIssuer) && !bytes.Equal(c.RawIssuer, c.RawSubject) {
				next = c
				break
			}
		}
		if next == nil || slices.Contains(chain, next) {
			break
		}
		chain = append(chain, next)
		current = next
	}
	return chain
}

// write puts the certificate with its chain and the key into dir, each written in full before it replaces the old one.
func write(dir string, leaf *x509.Certificate, chain []*x509.Certificate, signer crypto.Signer) error {
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		probe := filepath.Join(dir, ".write-test")
		if f, err := os.Create(probe); err != nil {
			return ui.Fail("Can't write to %s. Fix its owner: sudo chown %d %s", dir, os.Getuid(), dir)
		} else {
			f.Close()
			os.Remove(probe)
		}
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	var fullchain bytes.Buffer
	for _, c := range append([]*x509.Certificate{leaf}, chain...) {
		_ = pem.Encode(&fullchain, &pem.Block{Type: "CERTIFICATE", Bytes: c.Raw})
	}
	der, err := x509.MarshalPKCS8PrivateKey(signer)
	if err != nil {
		return err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	for name, data := range map[string][]byte{"fullchain.pem": fullchain.Bytes(), "key.pem": keyPEM} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path+".part", data, 0o600); err != nil {
			return err
		}
		if err := os.Rename(path+".part", path); err != nil {
			return err
		}
	}
	ui.OK("Copied to certs/fullchain.pem and certs/key.pem")
	return nil
}

// Expiry is when the first certificate in a PEM file expires.
func Expiry(path string) (time.Time, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return time.Time{}, err
	}
	certs := parseCerts(data)
	if len(certs) == 0 {
		return time.Time{}, errors.New("no certificate in " + path)
	}
	return certs[0].NotAfter, nil
}

/*===== Parsing =====*/

// candidates lists the files in folder and its direct subfolders with one of the extensions, sorted by path.
func candidates(folder string, exts ...string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(folder, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		depth := strings.Count(strings.TrimPrefix(path, folder), "/")
		if d.IsDir() && depth >= 2 {
			return fs.SkipDir
		}
		if d.Type().IsRegular() && slices.Contains(exts, strings.ToLower(filepath.Ext(path))) {
			files = append(files, path)
		}
		return nil
	})
	slices.Sort(files)
	return files, err
}

// parseCerts reads every certificate in a PEM file, or the one in a DER file.
func parseCerts(data []byte) []*x509.Certificate {
	var certs []*x509.Certificate
	if !bytes.Contains(data, []byte("-----BEGIN CERTIFICATE-----")) {
		if c, err := x509.ParseCertificate(data); err == nil {
			certs = append(certs, c)
		}
		return certs
	}
	for {
		var block *pem.Block
		block, data = pem.Decode(data)
		if block == nil {
			return certs
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		if c, err := x509.ParseCertificate(block.Bytes); err == nil {
			certs = append(certs, c)
		}
	}
}

// parseKey reads the first unencrypted private key in a PEM file: PKCS #8, PKCS #1 (RSA) or SEC 1 (EC).
func parseKey(data []byte) crypto.Signer {
	for {
		var block *pem.Block
		block, data = pem.Decode(data)
		if block == nil {
			return nil
		}
		if !strings.HasSuffix(block.Type, "PRIVATE KEY") {
			continue
		}
		if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
			if signer, ok := k.(crypto.Signer); ok {
				return signer
			}
		}
		if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
			return k
		}
		if k, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
			return k
		}
	}
}

func samePublicKey(a, b crypto.PublicKey) bool {
	switch a := a.(type) {
	case *rsa.PublicKey:
		return a.Equal(b)
	case *ecdsa.PublicKey:
		return a.Equal(b)
	case ed25519.PublicKey:
		return a.Equal(b)
	}
	return false
}

func plain(certs []cert) []*x509.Certificate {
	out := make([]*x509.Certificate, len(certs))
	for i, c := range certs {
		out[i] = c.Certificate
	}
	return out
}
