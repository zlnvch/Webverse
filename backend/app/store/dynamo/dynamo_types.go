package dynamo

import (
	"strings"

	"github.com/zlnvch/webverse/models"
)

type dynamoUser struct {
	PK            string `dynamodbav:"PK"`
	SK            string `dynamodbav:"SK"`
	Id            string `dynamodbav:"Id"`
	Provider      string `dynamodbav:"Provider"`
	ProviderId    string `dynamodbav:"ProviderId"`
	Username      string `dynamodbav:"Username"`
	Created       int64  `dynamodbav:"Created"`
	StrokeCount   int    `dynamodbav:"StrokeCount"`
	KeyVersion    int    `dynamodbav:"KeyVersion"`
	SaltKEK       string `dynamodbav:"SaltKEK"`
	EncryptedDEK1 string `dynamodbav:"EncryptedDEK1"`
	NonceDEK1     string `dynamodbav:"NonceDEK1"`
	EncryptedDEK2 string `dynamodbav:"EncryptedDEK2"`
	NonceDEK2     string `dynamodbav:"NonceDEK2"`
}

// Map domain User -> Dynamo
func userToDynamo(u models.User) dynamoUser {
	return dynamoUser{
		PK:            "USER#" + u.Provider + "#" + u.ProviderId,
		SK:            "PROFILE",
		Id:            u.Id,
		Provider:      u.Provider,
		ProviderId:    u.ProviderId,
		Username:      u.Username,
		Created:       u.Created,
		StrokeCount:   u.StrokeCount,
		KeyVersion:    u.KeyVersion,
		SaltKEK:       u.SaltKEK,
		EncryptedDEK1: u.EncryptedDEK1,
		NonceDEK1:     u.NonceDEK1,
		EncryptedDEK2: u.EncryptedDEK2,
		NonceDEK2:     u.NonceDEK2,
	}
}

// Map Dynamo -> domain User
func userFromDynamo(du dynamoUser) models.User {
	return models.User{
		Id:            du.Id,
		Username:      du.Username,
		Provider:      du.Provider,
		ProviderId:    du.ProviderId,
		Created:       du.Created,
		StrokeCount:   du.StrokeCount,
		KeyVersion:    du.KeyVersion,
		SaltKEK:       du.SaltKEK,
		EncryptedDEK1: du.EncryptedDEK1,
		NonceDEK1:     du.NonceDEK1,
		EncryptedDEK2: du.EncryptedDEK2,
		NonceDEK2:     du.NonceDEK2,
	}
}

type dynamoStroke struct {
	PK            string `dynamodbav:"PK"`
	SK            string `dynamodbav:"SK"`
	UserId        string `dynamodbav:"UserId"`
	Layer         string `dynamodbav:"Layer"`
	Nonce         string `dynamodbav:"Nonce"`
	StrokeContent []byte `dynamodbav:"StrokeContent"`
}

// Map domain StrokeRecord -> Dynamo
func strokeRecordToDynamo(sr models.StrokeRecord) dynamoStroke {
	var layer string
	switch sr.Layer {
	case models.LayerPublic:
		layer = "Public"
	case models.LayerPrivate:
		layer = "Private#" + sr.LayerId
	}

	return dynamoStroke{
		PK:            "STROKE#" + sr.PageKey,
		SK:            sr.Stroke.Id,
		UserId:        sr.Stroke.UserId,
		Nonce:         sr.Stroke.Nonce,
		Layer:         layer,
		StrokeContent: sr.Stroke.Content,
	}
}

// Map Dynamo -> domain StrokeRecord
func strokeRecordFromDynamo(ds dynamoStroke) models.StrokeRecord {
	var layer models.LayerType
	var layerId string
	if ds.Layer == "Public" {
		layer = models.LayerPublic
	} else if strings.HasPrefix(ds.Layer, "Private#") {
		layerId = ds.Layer[8:]
	}

	stroke := models.Stroke{Id: ds.SK, UserId: ds.UserId, Nonce: ds.Nonce, Content: ds.StrokeContent}

	return models.StrokeRecord{
		PageKey: ds.PK[7:],
		Layer:   layer,
		LayerId: layerId,
		Stroke:  stroke,
	}
}

// Map Dynamo -> domain StrokeRecord
func strokeFromDynamo(ds dynamoStroke) models.Stroke {
	return models.Stroke{
		Id:      ds.SK,
		UserId:  ds.UserId,
		Nonce:   ds.Nonce,
		Content: ds.StrokeContent,
	}
}
