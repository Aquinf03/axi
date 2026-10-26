#!/bin/bash

DIR_GEN=()
FILE_GEN=( ".axi_root")

GENERATED=0

if [ "$1" == "ungen" ]; then
	echo -e "${BOLD}[ * ] Removing generated files"

	if [ "${2,,}" == "yes" ] || [ "${2,,}" == "y" ]; then
		answer="Y"
	else
		echo -e "${RED}[ WARN ] Are you sure that you want to continue? This will remove all existing data [ Y / N ]${RESET}"

		read answer
	fi

	if [ "${answer,,}" == "yes" ] || [ "${answer,,}" == "y" ] ; then
		for dir in "${DIR_GEN[@]}"; do
			if [ ! -d "$dir" ]; then
				continue
			fi

			printf "${BOLD}${BRIGHT_GREEN}[ RMDIR ] Generating \`$dir\` directory${RESET} " ; rm -r $dir ; echo -e "${BOLD}${BRIGHT_GREEN}[ OK ]${RESET}"
		done

		for file in "${FILE_GEN[@]}"; do
			if [ ! -f "$file" ]; then
				continue
			fi

			printf "${BOLD}${BRIGHT_GREEN}[ RM ] Generating \`$file\` file${RESET} " ; rm $file ; echo -e "${BOLD}${BRIGHT_GREEN}[ OK ]${RESET}"
		done

		echo -e "[ DONE ]${RESET}"

	else
		echo -e "${RESET}Abort."
	fi

	echo -e "${BOLD}${CYAN}[ NOTE ] Execute this file without the \`ungen\` flag to generate all files"
	exit
fi

for dir in "${DIR_GEN[@]}"; do
	if [ -d "$dir" ]; then
		continue
	fi

	printf "${BOLD}${BRIGHT_GREEN}[ MKDIR ] Generating \`$dir\` directory${RESET} " ; mkdir -p $dir ; echo -e "${BOLD}${BRIGHT_GREEN}[ OK ]${RESET}"

	GENERATED=1
done

for file in "${FILE_GEN[@]}"; do
	if [ -f "$file" ]; then
		continue
	fi

	printf "${BOLD}${BRIGHT_GREEN}[ TOUCH ] Generating \`$file\` file${RESET} " ; touch $file ; echo -e "${BOLD}${BRIGHT_GREEN}[ OK ]${RESET}"
	GENERATED=1
done

if [ $GENERATED -eq 1 ]; then
	echo -e "[ DONE ]"

elif [ $GENERATED -eq 0 ]; then
	echo -e "[ DONE ] No files to generate"
fi

