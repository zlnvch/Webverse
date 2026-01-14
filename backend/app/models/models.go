package models

type User struct {
	Id            string
	Username      string
	Provider      string
	ProviderId    string
	Created       int64
	StrokeCount   int
	KeyVersion    int
	SaltKEK       string
	EncryptedDEK1 string
	NonceDEK1     string
	EncryptedDEK2 string
	NonceDEK2     string
}

type Stroke struct {
	Id      string `json:"id"`
	UserId  string `json:"userId"`
	Nonce   string `json:"nonce"`
	Content []byte `json:"content"`
}

type LayerType int

const (
	LayerPublic LayerType = iota
	LayerPrivate
)

type StrokeRecord struct {
	PageKey string
	Layer   LayerType
	LayerId string
	Stroke  Stroke
}
