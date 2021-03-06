# ~/.bashrc: executed by bash(1) for non-login shells.
# see /usr/share/doc/bash/examples/startup-files (in the package bash-doc)
# for examples

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

# don't put duplicate lines in the history. See bash(1) for more options
# don't overwrite GNU Midnight Commander's setting of `ignorespace'.
HISTCONTROL=$HISTCONTROL${HISTCONTROL+:}ignoredups
# ... or force ignoredups and ignorespace
HISTCONTROL=ignoreboth

# append to the history file, don't overwrite it
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

# make less more friendly for non-text input files, see lesspipe(1)
#[ -x /usr/bin/lesspipe ] && eval "$(SHELL=/bin/sh lesspipe)"

# set variable identifying the chroot you work in (used in the prompt below)
if [ -z "$debian_chroot" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# set a fancy prompt (non-color, unless we know we "want" color)
case "$TERM" in
    xterm-color) color_prompt=yes;;
esac

# uncomment for a colored prompt, if the terminal has the capability; turned
# off by default to not distract the user: the focus in a terminal window
# should be on the output of commands, not on the prompt
# force_color_prompt=yes

if [ -n "$force_color_prompt" ]; then
    if [ -x /usr/bin/tput ] && tput setaf 1 >&/dev/null; then
	# We have color support; assume it's compliant with Ecma-48
	# (ISO/IEC-6429). (Lack of such support is extremely rare, and such
	# a case would tend to support setf rather than setaf.)
	color_prompt=yes
    else
	color_prompt=
    fi
fi

if [ "$color_prompt" = yes ]; then
    PS1='${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
else
    PS1='${debian_chroot:+($debian_chroot)}\u@\h:\w\$ '
fi
unset color_prompt force_color_prompt

red='\[\e[0;31m\]'
RED='\[\e[1;31m\]'
blue='\[\e[0;34m\]'
BLUE='\[\e[1;34m\]'
cyan='\[\e[0;36m\]'
CYAN='\[\e[1;36m\]'
green='\[\e[0;32m\]'
GREEN='\[\e[1;32m\]'
yellow='\[\e[0;33m\]'
YELLOW='\[\e[1;33m\]'
PURPLE='\[\e[1;35m\]'
purple='\[\e[0;35m\]'
nc='\[\e[0m\]'

if [ "$UID" = 0 ]; then
    PS1="$red\u$nc@$red\H$nc:$CYAN\w$nc\\n$red#$nc "
else
    PS1="\e[43m\e[30m[ \e[30m\u\e[30m@\amxlnx \e[44m\e[30m \w ]$nc $yellow\$\]\]\]\]\]\] "
fi
# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    #alias dir='dir --color=auto'
    #alias vdir='vdir --color=auto'

    #alias grep='grep --color=auto'
    #alias fgrep='fgrep --color=auto'
    #alias egrep='egrep --color=auto'
fi

# some more ls aliases
alias ll='ls -lh'
alias la='ls -A'
alias l='ls -CF'

# Alias definitions.
# You may want to put all your additions into a separate file like ~/.bash_aliases, instead of adding them here directly.  See /usr/share/doc/bash-doc/examples in the bash-doc package.  
if [ -f ~/.bash_aliases ]; then
    . ~/.bash_aliases
fi

# Default parameter to send to the "less" command
# -R: show ANSI colors correctly; -i: case insensitive search
LESS="-R -i"

# enable programmable completion features (you don't need to enable
# this, if it's already enabled in /etc/bash.bashrc and /etc/profile
# sources /etc/bash.bashrc).
if [ -f /etc/bash_completion ] && ! shopt -oq posix; then
    . /etc/bash_completion
fi

# If this is an xterm set the title to user@host:dir
case "$TERM" in
xterm*|rxvt*)
    PS1="\[\e]0;${debian_chroot:+($debian_chroot)}\u@\h: \w\a\]$PS1"
    ;;
*)
    ;;
esac

# Add sbin directories to PATH.  This is useful on systems that have sudo

[ -z "${PATH##*/sbin*}" ] || PATH=$PATH:/sbin:/usr/sbin


# Add xdg (bspwm) path

# Add rustc/cargo to path

export PATH="$HOME/.cargo/bin:$PATH"

XDG_CONFIG_HOME="$HOME/.config"
export XDG_CONFIG_HOME


#export PS1="\[\e[34m\]\w\[\e[m\]\n\[\e[37m\]>\[\e[m\] "

# export PS1="\[\e[37;41m\] \u\[\e[m\]\[\e[37;41m\]@\[\e[m\]\[\e[37;41m\]deb \[\e[m\]\[\e[31;43m\]▓▒░ \[\e[m\]\[\e[43m\]\w \[\e[m\]\[\e[33m\]▓▒░\[\e[m\] "

# export PS1="\[\e[43m\] \w \[\e[m\]\[\e[33;41m\]▒░\[\e[m\]\[\e[41m\] > \[\e[m\]\[\e[31m\]▓▒░\[\e[m\] "


# get current branch in git repo
function parse_git_branch() {
	BRANCH=`git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/\1/'`
	if [ ! "${BRANCH}" == "" ]
	then
		STAT=`parse_git_dirty`
		echo "[${BRANCH}${STAT}]"
	else
		echo ""
	fi
}

# get current status of git repo
function parse_git_dirty {
	status=`git status 2>&1 | tee`
	dirty=`echo -n "${status}" 2> /dev/null | grep "modified:" &> /dev/null; echo "$?"`
	untracked=`echo -n "${status}" 2> /dev/null | grep "Untracked files" &> /dev/null; echo "$?"`
	ahead=`echo -n "${status}" 2> /dev/null | grep "Your branch is ahead of" &> /dev/null; echo "$?"`
	newfile=`echo -n "${status}" 2> /dev/null | grep "new file:" &> /dev/null; echo "$?"`
	renamed=`echo -n "${status}" 2> /dev/null | grep "renamed:" &> /dev/null; echo "$?"`
	deleted=`echo -n "${status}" 2> /dev/null | grep "deleted:" &> /dev/null; echo "$?"`
	bits=''
	if [ "${renamed}" == "0" ]; then
		bits=">${bits}"
	fi
	if [ "${ahead}" == "0" ]; then
		bits="*${bits}"
	fi
	if [ "${newfile}" == "0" ]; then
		bits="+${bits}"
	fi
	if [ "${untracked}" == "0" ]; then
		bits="?${bits}"
	fi
	if [ "${deleted}" == "0" ]; then
		bits="x${bits}"
	fi
	if [ "${dirty}" == "0" ]; then
		bits="!${bits}"
	fi
	if [ ! "${bits}" == "" ]; then
		echo " ${bits}"
	else
		echo ""
	fi
}

# export PS1="\[\e[35m\]\W \[\e[m\]\`parse_git_branch\`\n\[\e[33m\]>\[\e[m\] "
export PS1="\[\e[36m\]\W\`parse_git_branch\` \[\e[m\] \[\e[31m\]λ\[\e[m\] "

# blinking cursor

echo -ne "\x1b[1 q"

# nvim alias

alias vim='/usr/bin/nvim'
alias vi='/usr/bin/nvim'

# etc aliases

alias cd..='cd ..'

# ranger alias

alias r='/usr/bin/ranger'

# auto-completion extension
[[ $PS1 && -f /usr/share/bash-completion/bash_completion ]] && \
    . /usr/share/bash-completion/bash_completion

# zsh-like partial completion - https://github.com/sio/bash-complete-partial-path

if [ -s "$HOME/.config/bash-complete-partial-path/bash_completion" ]
then
    source "$HOME/.config/bash-complete-partial-path/bash_completion"
    _bcpp --defaults
fi
alias config='/usr/bin/git --git-dir=/home/me/.cfg/ --work-tree=/home/me'
alias config='/usr/bin/git --git-dir=/home/me/.dots/ --work-tree=/home/me'


# editor = nvim
export EDITOR=nvim


# todo program
alias todo='/home/me/programs/todo/todo.sh'

# doom alias
alias doom='/home/me/.emacs.d/bin/doom'
