package main

import (
	"database/sql/driver"

	"modernc.org/sqlite"
)

func sqliteDriver() driver.Driver { return &sqlite.Driver{} }
