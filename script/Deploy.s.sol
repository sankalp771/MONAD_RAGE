// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RoastArena.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPk);

        RoastArena arena = new RoastArena();
        console.log("RoastArena deployed at:", address(arena));

        vm.stopBroadcast();
    }
}
