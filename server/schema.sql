-- Minimal schema for wallet/auth features
CREATE DATABASE IF NOT EXISTS `NeonGames`;
USE `NeonGames`;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `username` VARCHAR(64) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `sc_balance` DECIMAL(32,8) NOT NULL DEFAULT 0,
  `public_key` VARCHAR(64) NULL,
  `secret_key` VARCHAR(64) NULL,
  `xrp_address` VARCHAR(64) NULL,
  `xrp_secret` VARCHAR(128) NULL,
  `eth_address` VARCHAR(64) NULL,
  `xrp_balance` DECIMAL(32,8) NOT NULL DEFAULT 0,
  `eth_balance` DECIMAL(32,8) NOT NULL DEFAULT 0,
  `xlm_balance` DECIMAL(32,8) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `ix_username` (`username`)npm
);

CREATE TABLE IF NOT EXISTS `jackpot_sc` (
  `id` INT PRIMARY KEY,
  `pool_sc` DECIMAL(32,8) NOT NULL DEFAULT 0
);
INSERT IGNORE INTO `jackpot_sc` (`id`, `pool_sc`) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS `app_config` (
  `k` VARCHAR(64) PRIMARY KEY,
  `v` TEXT NOT NULL
);
