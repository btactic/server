﻿var config = require('./config.json');var configMySql = config["mysql"];var mysql = require('mysql');var tableChanges = configMySql["tableChanges"],	tableCallbacks = configMySql["tableCallbacks"],	tableResult = configMySql["tableResult"],	tablePucker = configMySql["tablePucker"];var pool  = mysql.createPool({	host		: configMySql["host"],	user		: configMySql["user"],	password	: configMySql["pass"],	database	: configMySql["database"],	charset		: configMySql["charset"]});var logger = require('./../../Common/sources/logger');var g_oCriticalSection = {}, lockTimeOut = 200;var maxPacketSize = 1024 * 1024 - 200; // Размер по умолчанию для запроса в базу данных (вычли 200 на поля)function sqlQuery (sqlCommand, callbackFunction) {	pool.getConnection(function(err, connection) {		if (err) {			logger.error('pool.getConnection error: %s', err);			callbackFunction(err, null);			return;		}		connection.query(sqlCommand, function (error, result) {			connection.release();			if (error) logger.error('sqlQuery: %s sqlCommand: %s', error, sqlCommand.slice(0, 50));			if (callbackFunction) callbackFunction(error, result);		});	});}function getDataFromTable (tableId, data, getCondition, callback) {	var table = getTableById(tableId);	var sqlCommand = "SELECT " + data + " FROM " + table + " WHERE " + getCondition + ";";	sqlQuery(sqlCommand, callback);}function deleteFromTable (tableId, deleteCondition) {	var table = getTableById(tableId);	var sqlCommand = "DELETE FROM " + table + " WHERE " + deleteCondition + ";";	sqlQuery(sqlCommand);}var c_oTableId = {	pucker		: 1,	callbacks	: 2,	changes		: 3};function getTableById (id) {	var res;	switch (id) {		case c_oTableId.pucker:			res = tablePucker;			break;		case c_oTableId.callbacks:			res = tableCallbacks;			break;		case c_oTableId.changes:			res = tableChanges;			break;	}	return res;}exports.tableId = c_oTableId;exports.loadTable = function (tableId, callbackFunction) {	var table = getTableById(tableId);	var sqlCommand = "SELECT * FROM " + table + ";";	sqlQuery(sqlCommand, callbackFunction);};exports.insertInTable = function (tableId) {	var table = getTableById(tableId);	var sqlCommand = "INSERT INTO " + table + " VALUES (";	for (var i = 1, l = arguments.length; i < l; ++i) {		sqlCommand += "'" + arguments[i] + "'";		if (i !== l - 1)			sqlCommand += ",";	}	sqlCommand += ");";	sqlQuery(sqlCommand);};exports.insertChanges = function (objChanges, docId, index, userId, userIdOriginal) {	lockCriticalSection(docId, function () {_insertChanges(0, objChanges, docId, index, userId, userIdOriginal);});};function _insertChanges (startIndex, objChanges, docId, index, userId, userIdOriginal) {	var sqlCommand = "INSERT INTO " + tableChanges + " VALUES";	for (var i = startIndex, l = objChanges.length; i < l; ++i, ++index) {		sqlCommand += "('" + docId + "','" + index + "','" + userId + "','" + userIdOriginal + "','"		+ objChanges[i].change + "')";		if (i === l - 1)			sqlCommand += ';';		else if (sqlCommand.length + objChanges[i + 1].change.length >= maxPacketSize) {			sqlCommand += ';';			(function (tmpStart, tmpIndex) {				sqlQuery(sqlCommand, function () {					// lock не снимаем, а продолжаем добавлять					_insertChanges(tmpStart, objChanges, docId, tmpIndex, userId, userIdOriginal);				});			})(i + 1, index + 1);			return;		} else			sqlCommand += ',';	}	sqlQuery(sqlCommand, function () {unLockCriticalSection(docId);});}exports.deleteChanges = function (docId, deleteIndex) {	lockCriticalSection(docId, function () {_deleteChanges(docId, deleteIndex);});};function _deleteChanges (docId, deleteIndex) {	var sqlCommand = "DELETE FROM " + tableChanges + " WHERE dc_key='" + docId + "'";	if (null !== deleteIndex)		sqlCommand += " AND dc_change_id >= " + deleteIndex;	sqlCommand += ";";	sqlQuery(sqlCommand, function () {unLockCriticalSection(docId);});}exports.deleteCallback = function (docId) {	deleteFromTable(c_oTableId.callbacks, "dc_key='" + docId + "'");};exports.deletePucker = function (docId) {	deleteFromTable(c_oTableId.pucker, "dp_key='" + docId + "'");};exports.getChanges = function (docId, callback) {	lockCriticalSection(docId, function () {_getChanges(docId, callback);});};function _getChanges (docId, callback) {	getDataFromTable(c_oTableId.changes, "*", "dc_key='" + docId + "'",		function (error, result) {unLockCriticalSection(docId); if (callback) callback(error, result);});}exports.checkStatusFile = function (docId, callbackFunction) {	var sqlCommand = "SELECT tr_status FROM " + tableResult + " WHERE tr_key='" + docId + "';";	sqlQuery(sqlCommand, callbackFunction);};exports.updateStatusFile = function (docId) {	// Статус OK = 1	var sqlCommand = "UPDATE " + tableResult + " SET tr_status=1 WHERE tr_key='" + docId + "';";	sqlQuery(sqlCommand);};// Критическая секцияfunction lockCriticalSection (id, callback) {	if (g_oCriticalSection[id]) {		// Ждем		setTimeout(function () {lockCriticalSection(id, callback);}, lockTimeOut);		return;	}	// Ставим lock	g_oCriticalSection[id] = true;	callback();}function unLockCriticalSection (id) {	delete g_oCriticalSection[id];}